import ipaddr from 'ipaddr.js';
import type { Types } from 'mongoose';
import {
  AI_CONSENT_VERSION,
  AI_KEY_TARGETS,
  AI_PROVIDERS,
  CUSTOM_ENDPOINT_PROVIDERS,
  DEFAULT_CHAT_MODEL,
  DEFAULT_EMBEDDING_MODEL,
  EMBEDDING_PROVIDERS,
  KEYED_PROVIDERS,
  type AiFeature,
  type AiKeyTarget,
  type AiKeyView,
  type AiProvider,
  type AiSettingsInput,
  type AiSettingsView,
  type AiStatusView,
  type AiTestResult,
  type EmbeddingProvider as EmbeddingProviderId,
  type KeyStatus,
} from '@campuslink/shared';
import { AiSettingsModel, type AiSettingsDoc } from './ai-settings.model.js';
import type { FieldCipher } from '../../lib/crypto.js';
import { isPublicAddress, type safeFetch } from '../../lib/safe-fetch.js';
import { badRequest } from '../../lib/errors.js';
import { audit, type RequestMetaLite } from '../audit/audit.service.js';
import type { ProfilesService } from '../profiles/profiles.service.js';
import type { AuthState } from '../../types.js';
import { chatProvider, embeddingProvider } from './ai/registry.js';
import {
  callJson,
  ProviderError,
  type EmbeddingProvider,
  type LLMProvider,
  type ProviderConnection,
} from './ai/provider.js';

/** The platform owner's optional default (environment); a college's own settings override it. */
export interface PlatformAiDefault {
  provider: AiProvider;
  apiKey: string | null;
  chatModel: string;
  baseUrl: string | null;
  embeddingProvider: EmbeddingProviderId | null;
  embeddingApiKey: string | null;
  embeddingModel: string;
  embeddingBaseUrl: string | null;
}

export interface AiSettingsDeps {
  cipher: FieldCipher;
  fetcher: typeof safeFetch;
  profiles: ProfilesService;
  /** Origins (`scheme://host[:port]`) the platform owner lets be private or plain http. */
  privateEndpoints: readonly string[];
  platformDefault: PlatformAiDefault | null;
}

interface KeyDoc {
  apiKeyEnc: string | null;
  last4: string | null;
  status: KeyStatus;
  validatedAt: Date | null;
  models: string[];
  error: string | null;
  setAt: Date | null;
  setBy: Types.ObjectId | string | null;
}
/** The settings with every default filled in (Mongoose types nested paths as optional). */
interface Settings {
  chatProvider: AiProvider | null;
  chatModel: string;
  embeddingProvider: EmbeddingProviderId | null;
  embeddingModel: string;
  baseUrl: string | null;
  embeddingBaseUrl: string | null;
  temperature: number | null;
  maxAnswerTokens: number;
  maxChunks: number;
  monthlyTokenBudget: number;
  dailyMessagesPerUser: number;
  chatRetentionDays: number;
  features: Record<AiFeature, boolean>;
  killSwitch: boolean;
  keys: Record<AiKeyTarget, KeyDoc>;
  consent: { version: string | null; acceptedAt: Date | null; acceptedBy: Types.ObjectId | null };
}

/** A ready-to-use provider plus what identifies its output (stored on chunks). */
export interface ActiveChat {
  provider: LLMProvider;
  model: string;
  platform: boolean;
}
export interface ActiveEmbedding {
  provider: EmbeddingProvider;
  model: string;
  /** `provider:model`: a change means existing vectors must be rebuilt, never mixed. */
  signature: string;
  platform: boolean;
}
export interface AiRuntime {
  settings: Settings;
  status: AiStatusView;
  chat: ActiveChat | null;
  embedding: ActiveEmbedding | null;
}

const YOUTUBE_PROBE = 'https://www.googleapis.com/youtube/v3/i18nLanguages?part=snippet&hl=en';
const needsKey = (p: string | null | undefined) => !!p && KEYED_PROVIDERS.includes(p);
/** Local OpenAI-compatible servers may run without a key. */
const keyOptional = (p: string | null | undefined) => !!p && CUSTOM_ENDPOINT_PROVIDERS.includes(p);
const emptyKey = (): KeyDoc => ({
  apiKeyEnc: null,
  last4: null,
  status: 'not_set',
  validatedAt: null,
  models: [],
  error: null,
  setAt: null,
  setBy: null,
});
const fieldError = (path: string, message: string) => badRequest(message, [{ path, message }]);

function normalize(d: AiSettingsDoc): Settings {
  const key = (k: Partial<KeyDoc> | null | undefined): KeyDoc => ({
    ...emptyKey(),
    ...Object.fromEntries(Object.entries(k ?? {}).filter(([, v]) => v !== undefined)),
    models: k?.models ?? [],
  });
  const f: Partial<Record<AiFeature, boolean | null>> = d.features ?? {};
  return {
    chatProvider: (d.chatProvider ?? null) as AiProvider | null,
    chatModel: d.chatModel ?? '',
    embeddingProvider: (d.embeddingProvider ?? null) as EmbeddingProviderId | null,
    embeddingModel: d.embeddingModel ?? '',
    baseUrl: d.baseUrl ?? null,
    embeddingBaseUrl: d.embeddingBaseUrl ?? null,
    temperature: d.temperature ?? null,
    maxAnswerTokens: d.maxAnswerTokens ?? 1024,
    maxChunks: d.maxChunks ?? 6,
    monthlyTokenBudget: d.monthlyTokenBudget ?? 0,
    dailyMessagesPerUser: d.dailyMessagesPerUser ?? 40,
    chatRetentionDays: d.chatRetentionDays ?? 180,
    features: {
      chatbot: !!f.chatbot,
      studentUploads: !!f.studentUploads,
      externalVideos: !!f.externalVideos,
      ocr: f.ocr ?? true,
      transcription: f.transcription ?? true,
      facultySeeChats: !!f.facultySeeChats,
    },
    killSwitch: !!d.killSwitch,
    keys: {
      chat: key(d.keys?.chat as Partial<KeyDoc> | null),
      embedding: key(d.keys?.embedding as Partial<KeyDoc> | null),
      youtube: key(d.keys?.youtube as Partial<KeyDoc> | null),
    },
    consent: {
      version: d.consent?.version ?? null,
      acceptedAt: d.consent?.acceptedAt ?? null,
      acceptedBy: d.consent?.acceptedBy ?? null,
    },
  };
}

/**
 * The college's AI study assistant settings: provider and models, the encrypted API keys (only the
 * last four characters ever leave the server), limits, toggles, consent, and the "Test connection"
 * probe. Every provider call goes through the SSRF-safe fetcher; private endpoints only when the
 * platform owner allowlisted them. Key changes, provider changes and consent are audit-logged.
 */
export class AiSettingsService {
  /** Back-fill and re-index hook (the indexing service registers it). */
  onEmbeddingReady: () => Promise<void> = async () => undefined;

  constructor(private readonly d: AiSettingsDeps) {}

  private async load(): Promise<Settings> {
    const doc = await AiSettingsModel.findOne().lean<AiSettingsDoc>();
    return normalize(doc ?? (new AiSettingsModel({}).toObject() as unknown as AiSettingsDoc));
  }

  /** Validates an endpoint: public https, or an origin the platform owner allowlisted. */
  private endpoint(raw: string | null, path: string): { url: string | null; private: boolean } {
    if (!raw) return { url: null, private: false };
    const u = new URL(raw);
    const url = `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
    if (this.d.privateEndpoints.includes(u.origin)) return { url, private: true };
    if (u.protocol !== 'https:') throw fieldError(path, 'Use a public https:// address');
    const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const privateName = /(^|\.)(localhost|local|internal|lan|home\.arpa)$/.test(host);
    if (privateName || (ipaddr.isValid(host) && !isPublicAddress(host)))
      throw fieldError(
        path,
        'Private network addresses can only be allowed by the platform owner (AI_PRIVATE_ENDPOINTS)',
      );
    return { url, private: false };
  }

  private isPrivate(url: string | null) {
    if (!url) return false;
    try {
      return this.d.privateEndpoints.includes(new URL(url).origin);
    } catch {
      return false;
    }
  }

  private decrypt(k: KeyDoc): string | null {
    return k.apiKeyEnc ? this.d.cipher.decrypt(k.apiKeyEnc) : null;
  }

  /** The embedding key: its own, or the chat key when both use the same provider and endpoint. */
  private embeddingKey(s: Settings): KeyDoc {
    const own = s.keys.embedding;
    const shared =
      own.status === 'not_set' &&
      !own.apiKeyEnc &&
      s.embeddingProvider === s.chatProvider &&
      (s.embeddingBaseUrl ?? s.baseUrl) === s.baseUrl;
    return shared ? s.keys.chat : own;
  }

  private conn(apiKey: string | null, baseUrl: string | null): ProviderConnection {
    return { apiKey, baseUrl, allowPrivateNetwork: this.isPrivate(baseUrl), fetcher: this.d.fetcher };
  }

  /** What is configured and usable right now, and the providers to call. */
  async runtime(): Promise<AiRuntime> {
    const s = await this.load();
    const pd = this.d.platformDefault;
    const consentOk = s.consent?.version === AI_CONSENT_VERSION;

    let chat: ActiveChat | null = null;
    let chatKeyBad = false;
    if (s.chatProvider) {
      const provider = s.chatProvider as AiProvider;
      const k = s.keys.chat;
      const usable = provider === 'mock' || k.status === 'valid';
      chatKeyBad = needsKey(provider) && k.status === 'invalid';
      const model = s.chatModel || DEFAULT_CHAT_MODEL[provider];
      if (usable && model)
        chat = {
          provider: chatProvider(provider, this.conn(this.decrypt(k), s.baseUrl ?? null)),
          model,
          platform: false,
        };
    } else if (pd && pd.chatModel) {
      chat = {
        provider: chatProvider(pd.provider, this.conn(pd.apiKey, pd.baseUrl)),
        model: pd.chatModel,
        platform: true,
      };
    }

    let embedding: ActiveEmbedding | null = null;
    if (s.embeddingProvider) {
      const provider = s.embeddingProvider as EmbeddingProviderId;
      const k = this.embeddingKey(s);
      const model = s.embeddingModel || DEFAULT_EMBEDDING_MODEL[provider];
      if ((provider === 'mock' || k.status === 'valid') && model)
        embedding = {
          provider: embeddingProvider(
            provider,
            this.conn(this.decrypt(k), s.embeddingBaseUrl ?? s.baseUrl ?? null),
          ),
          model,
          signature: `${provider}:${model}`,
          platform: false,
        };
    } else if (!s.chatProvider && pd?.embeddingProvider && pd.embeddingModel) {
      embedding = {
        provider: embeddingProvider(
          pd.embeddingProvider,
          this.conn(pd.embeddingApiKey ?? pd.apiKey, pd.embeddingBaseUrl ?? pd.baseUrl),
        ),
        model: pd.embeddingModel,
        signature: `${pd.embeddingProvider}:${pd.embeddingModel}`,
        platform: true,
      };
    }

    // Excerpts leave the platform only after the admin accepted the notice (the demo sends nothing).
    const external = (p: { provider: { id: string } } | null) => !!p && p.provider.id !== 'mock';
    if (!consentOk && external(chat)) chat = null;
    if (!consentOk && external(embedding)) embedding = null;
    if (s.killSwitch) {
      chat = null;
      embedding = null;
    }

    const configured = !!s.chatProvider || !!pd;
    const reason: AiStatusView['reason'] = s.killSwitch
      ? 'kill_switch'
      : !s.features.chatbot
        ? 'chatbot_off'
        : !configured
          ? 'not_configured'
          : chatKeyBad
            ? 'key_invalid'
            : !chat && !consentOk && (s.chatProvider ?? pd?.provider) !== 'mock'
              ? 'consent_needed'
              : !chat
                ? 'not_configured'
                : null;
    const status: AiStatusView = {
      answers: !!chat && s.features.chatbot,
      semantic: !!embedding,
      reason,
      demo: chat?.provider.id === 'mock',
    };
    return { settings: s, status, chat: status.answers ? chat : null, embedding };
  }

  async status(): Promise<AiStatusView> {
    return (await this.runtime()).status;
  }

  async view(): Promise<AiSettingsView> {
    const { settings: s, status } = await this.runtime();
    const key = (k: KeyDoc): AiKeyView => ({
      status: k.status as AiKeyView['status'],
      last4: k.last4 ?? null,
      validatedAt: k.validatedAt ? k.validatedAt.toISOString() : null,
      models: k.models ?? [],
      error: k.error ?? null,
    });
    const by = s.consent?.acceptedBy
      ? (await this.d.profiles.refsFor([s.consent.acceptedBy])).get(String(s.consent.acceptedBy))
      : undefined;
    const pd = this.d.platformDefault;
    return {
      chatProvider: (s.chatProvider ?? null) as AiProvider | null,
      chatModel: s.chatModel ?? '',
      embeddingProvider: (s.embeddingProvider ?? null) as EmbeddingProviderId | null,
      embeddingModel: s.embeddingModel ?? '',
      baseUrl: s.baseUrl ?? null,
      embeddingBaseUrl: s.embeddingBaseUrl ?? null,
      temperature: s.temperature ?? null,
      maxAnswerTokens: s.maxAnswerTokens,
      maxChunks: s.maxChunks,
      monthlyTokenBudget: s.monthlyTokenBudget,
      dailyMessagesPerUser: s.dailyMessagesPerUser,
      chatRetentionDays: s.chatRetentionDays,
      features: { ...s.features },
      killSwitch: s.killSwitch,
      keys: {
        chat: key(s.keys.chat),
        embedding: key(this.embeddingKey(s)),
        youtube: key(s.keys.youtube),
      },
      consent:
        s.consent?.version && s.consent.acceptedAt && by
          ? { version: s.consent.version, acceptedAt: s.consent.acceptedAt.toISOString(), by }
          : null,
      consentVersion: AI_CONSENT_VERSION,
      platformDefault: pd ? { provider: pd.provider, embeddingProvider: pd.embeddingProvider } : null,
      status,
      providers: AI_PROVIDERS.map((id) => ({
        id,
        embeddings: (EMBEDDING_PROVIDERS as readonly string[]).includes(id),
        needsKey: needsKey(id) && !keyOptional(id),
        customEndpoint: CUSTOM_ENDPOINT_PROVIDERS.includes(id),
        defaultChatModel: DEFAULT_CHAT_MODEL[id],
      })),
    };
  }

  private async doc() {
    return (await AiSettingsModel.findOne()) ?? new AiSettingsModel({});
  }

  /** Saves settings. Changing a provider removes that provider's saved key (it would not work). */
  async update(viewer: AuthState, body: AiSettingsInput, meta: RequestMetaLite) {
    const chatEndpoint =
      body.chatProvider === 'openai_compatible' ? this.endpoint(body.baseUrl, 'baseUrl') : null;
    const embedEndpoint =
      body.embeddingProvider === 'openai_compatible'
        ? this.endpoint(body.embeddingBaseUrl ?? body.baseUrl, 'embeddingBaseUrl')
        : null;
    if (body.chatProvider === 'openai_compatible' && !chatEndpoint?.url)
      throw fieldError('baseUrl', 'Enter the endpoint address');
    if (body.embeddingProvider === 'openai_compatible' && !embedEndpoint?.url)
      throw fieldError('embeddingBaseUrl', 'Enter the embeddings endpoint address');

    const doc = await this.doc();
    const changed: string[] = [];
    const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
      if (JSON.stringify(doc.get(k as string)) !== JSON.stringify(v)) {
        changed.push(k as string);
        doc.set(k as string, v);
      }
    };
    const before = {
      chat: doc.chatProvider ?? null,
      embed: doc.embeddingProvider ?? null,
      baseUrl: doc.baseUrl ?? null,
      embedBase: doc.embeddingBaseUrl ?? null,
      kill: !!doc.killSwitch,
    };
    set('chatProvider', body.chatProvider);
    set('chatModel', body.chatModel || (body.chatProvider ? DEFAULT_CHAT_MODEL[body.chatProvider] : ''));
    set('embeddingProvider', body.embeddingProvider);
    set(
      'embeddingModel',
      body.embeddingModel || (body.embeddingProvider ? DEFAULT_EMBEDDING_MODEL[body.embeddingProvider] : ''),
    );
    set('baseUrl', chatEndpoint?.url ?? null);
    set('embeddingBaseUrl', embedEndpoint?.url ?? null);
    set('temperature', body.temperature);
    set('maxAnswerTokens', body.maxAnswerTokens);
    set('maxChunks', body.maxChunks);
    set('monthlyTokenBudget', body.monthlyTokenBudget);
    set('dailyMessagesPerUser', body.dailyMessagesPerUser);
    set('chatRetentionDays', body.chatRetentionDays);
    set('features', body.features as Settings['features']);
    set('killSwitch', body.killSwitch);
    if (before.chat !== body.chatProvider || before.baseUrl !== (chatEndpoint?.url ?? null))
      doc.set('keys.chat', emptyKey());
    if (before.embed !== body.embeddingProvider || before.embedBase !== (embedEndpoint?.url ?? null))
      doc.set('keys.embedding', emptyKey());
    await doc.save();

    if (before.chat !== body.chatProvider || before.embed !== body.embeddingProvider)
      await audit.record(
        {
          action: 'ai.provider_changed',
          actorId: viewer.userId,
          targetType: 'ai_settings',
          meta: {
            chatFrom: before.chat,
            chatTo: body.chatProvider,
            embeddingFrom: before.embed,
            embeddingTo: body.embeddingProvider,
          },
        },
        meta,
      );
    if (before.kill !== body.killSwitch)
      await audit.record(
        {
          action: 'ai.kill_switch',
          actorId: viewer.userId,
          targetType: 'ai_settings',
          meta: { on: body.killSwitch },
        },
        meta,
      );
    if (changed.length)
      await audit.record(
        {
          action: 'ai.settings_changed',
          actorId: viewer.userId,
          targetType: 'ai_settings',
          meta: { changed },
        },
        meta,
      );
    if (changed.some((c) => c === 'embeddingProvider' || c === 'embeddingModel'))
      await this.onEmbeddingReady();
    return this.view();
  }

  /** Stores a key (encrypted), then tests it at once. Only the last four characters are kept in clear. */
  async setKey(viewer: AuthState, target: AiKeyTarget, key: string, meta: RequestMetaLite) {
    const s = await this.load();
    if (target === 'chat' && !needsKey(s.chatProvider))
      throw fieldError('key', 'Choose a provider that uses a key, and save, first');
    if (target === 'embedding' && !needsKey(s.embeddingProvider))
      throw fieldError('key', 'Choose an embedding provider that uses a key, and save, first');
    const doc = await this.doc();
    const replaced = !!doc.get(`keys.${target}.apiKeyEnc`);
    doc.set(`keys.${target}`, {
      ...emptyKey(),
      apiKeyEnc: this.d.cipher.encrypt(key),
      last4: key.slice(-4),
      setAt: new Date(),
      setBy: viewer.userId,
    });
    await doc.save();
    await audit.record(
      {
        action: replaced ? 'ai.key_replaced' : 'ai.key_set',
        actorId: viewer.userId,
        targetType: 'ai_settings',
        meta: { target },
      },
      meta,
    );
    const result = await this.test(viewer, target, meta);
    return { result, settings: await this.view() };
  }

  async removeKey(viewer: AuthState, target: AiKeyTarget, meta: RequestMetaLite) {
    const doc = await AiSettingsModel.findOne();
    if (doc?.get(`keys.${target}.apiKeyEnc`)) {
      doc.set(`keys.${target}`, emptyKey());
      await doc.save();
      await audit.record(
        { action: 'ai.key_removed', actorId: viewer.userId, targetType: 'ai_settings', meta: { target } },
        meta,
      );
    }
    return this.view();
  }

  /**
   * "Test connection": one tiny request (the model list) with the stored key. A rejected key is
   * marked invalid; an outage leaves the status as it was. The key never appears in the result.
   */
  async test(viewer: AuthState, target: AiKeyTarget, meta: RequestMetaLite): Promise<AiTestResult> {
    const s = await this.load();
    const k = target === 'embedding' ? this.embeddingKey(s) : s.keys[target];
    const ownKey = target === 'embedding' && k === s.keys.chat ? 'chat' : target;
    const apiKey = this.decrypt(k);
    let models: string[] = [];
    let error: ProviderError | null = null;
    try {
      if (target === 'youtube') {
        if (!apiKey) throw new ProviderError('auth', 'No API key is set');
        await callJson(this.conn(apiKey, null), YOUTUBE_PROBE, {
          headers: { 'x-goog-api-key': apiKey },
          timeoutMs: 10_000,
        });
      } else {
        const id = target === 'chat' ? s.chatProvider : s.embeddingProvider;
        if (!id) throw new ProviderError('bad_request', 'Choose a provider first');
        if (needsKey(id) && !keyOptional(id) && !apiKey) throw new ProviderError('auth', 'No API key is set');
        const base = target === 'chat' ? (s.baseUrl ?? null) : (s.embeddingBaseUrl ?? s.baseUrl ?? null);
        const conn = this.conn(apiKey, base);
        models =
          target === 'chat'
            ? await chatProvider(id as AiProvider, conn).listModels()
            : await embeddingProvider(id as EmbeddingProviderId, conn).listModels();
      }
    } catch (e) {
      error = e instanceof ProviderError ? e : new ProviderError('network', 'Could not reach the provider');
    }
    const ok = !error;
    const patch: Record<string, unknown> = {
      [`keys.${ownKey}.error`]: error ? error.message.slice(0, 300) : null,
    };
    if (ok) {
      patch[`keys.${ownKey}.status`] = 'valid';
      patch[`keys.${ownKey}.validatedAt`] = new Date();
      patch[`keys.${ownKey}.models`] = models.slice(0, 200).map((m) => m.slice(0, 120));
    } else if (error?.kind === 'auth') patch[`keys.${ownKey}.status`] = 'invalid';
    // Guarded on the key tested, so a slow test never overwrites the status of a newer key.
    await AiSettingsModel.updateOne({ [`keys.${ownKey}.apiKeyEnc`]: k.apiKeyEnc ?? null }, { $set: patch });
    await audit.record(
      { action: 'ai.key_tested', actorId: viewer.userId, targetType: 'ai_settings', meta: { target, ok } },
      meta,
    );
    if (ok && target !== 'youtube') await this.onEmbeddingReady();
    return { ok, models: ok ? models.slice(0, 200) : [], error: error?.message ?? null };
  }

  /** The admin accepts the data-processing notice (versioned and audit-logged). */
  async acceptConsent(viewer: AuthState, version: string, meta: RequestMetaLite) {
    const doc = await this.doc();
    doc.set('consent', { version, acceptedAt: new Date(), acceptedBy: viewer.userId });
    await doc.save();
    await audit.record(
      { action: 'ai.consent_accepted', actorId: viewer.userId, targetType: 'ai_settings', meta: { version } },
      meta,
    );
    await this.onEmbeddingReady();
    return this.view();
  }

  /**
   * A connection to OpenAI with the college's own key, for transcription: only when the college
   * chose OpenAI (answers or embeddings), the key works, the notice is accepted and AI is not stopped.
   */
  openAiConnection(rt: AiRuntime): ProviderConnection | null {
    const s = rt.settings;
    if (s.killSwitch || s.consent.version !== AI_CONSENT_VERSION) return null;
    const k =
      s.chatProvider === 'openai' && s.keys.chat.status === 'valid'
        ? s.keys.chat
        : s.embeddingProvider === 'openai' && this.embeddingKey(s).status === 'valid'
          ? this.embeddingKey(s)
          : null;
    const apiKey = k ? this.decrypt(k) : null;
    return apiKey ? this.conn(apiKey, null) : null;
  }

  /** The decrypted YouTube key for external video suggestions (server use only), when enabled. */
  async youtubeKey(): Promise<string | null> {
    const s = await this.load();
    if (s.killSwitch || !s.features.externalVideos || s.keys.youtube.status !== 'valid') return null;
    return this.decrypt(s.keys.youtube);
  }

  // ── Privacy: settings belong to the college; only the admin's id is personal ─────────────
  async exportFor(userId: string) {
    const doc = await AiSettingsModel.findOne().lean<AiSettingsDoc>();
    if (!doc) return [];
    const s = normalize(doc);
    const keysSet = AI_KEY_TARGETS.filter((t) => String(s.keys[t].setBy) === userId);
    const consent = String(s.consent.acceptedBy) === userId ? s.consent.version : null;
    return keysSet.length || consent ? [{ keysSet, consentAccepted: consent ?? null }] : [];
  }

  /** The consent record is kept as evidence (by id); who set a key is forgotten. */
  async eraseFor(userId: string) {
    for (const t of AI_KEY_TARGETS)
      await AiSettingsModel.updateOne(
        { [`keys.${t}.setBy`]: userId },
        { $set: { [`keys.${t}.setBy`]: null } },
      );
  }
}
