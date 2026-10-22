import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CircleAlert, KeyRound, PlugZap, Power, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';
import {
  AI_FEATURES,
  EMBEDDING_PROVIDERS,
  type AiFeature,
  type AiKeyTarget,
  type AiKeyView,
  type AiProvider,
  type AiSettingsInput,
  type AiSettingsView,
  type AiTestResult,
  type EmbeddingProvider,
} from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { ChoiceGroup } from '../../components/ui/choice-group';
import { Field, Input, PasswordInput, Select } from '../../components/ui/field';
import { Badge, Card, Skeleton } from '../../components/ui/misc';
import { Switch } from '../../components/ui/switch';
import { FormError } from '../../components/layout/auth-layout';
import { api, ApiError } from '../../lib/api';
import { aiSettings } from '../../lib/queries';
import { formatDateTime } from '../../lib/format';
import { toast } from '../../lib/toast';
import { cn } from '../../lib/cn';

type Draft = AiSettingsInput;
const NONE = '';

const toDraft = (v: AiSettingsView): Draft => ({
  chatProvider: v.chatProvider,
  chatModel: v.chatModel,
  embeddingProvider: v.embeddingProvider,
  embeddingModel: v.embeddingModel,
  baseUrl: v.baseUrl,
  embeddingBaseUrl: v.embeddingBaseUrl,
  temperature: v.temperature,
  maxAnswerTokens: v.maxAnswerTokens,
  maxChunks: v.maxChunks,
  monthlyTokenBudget: v.monthlyTokenBudget,
  dailyMessagesPerUser: v.dailyMessagesPerUser,
  chatRetentionDays: v.chatRetentionDays,
  features: { ...v.features },
  killSwitch: v.killSwitch,
});

function Section({
  id,
  icon,
  title,
  children,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <Card variant="raised" className="grid gap-4 p-5" aria-labelledby={id}>
      <h2 id={id} className="flex items-center gap-2 text-title font-semibold">
        <span className="text-brand-ink [&_svg]:size-5" aria-hidden>
          {icon}
        </span>
        {title}
      </h2>
      {children}
    </Card>
  );
}

function KeyStatus({ k }: { k: AiKeyView }) {
  const { t } = useTranslation();
  return (
    <p className="flex flex-wrap items-center gap-2 text-meta">
      <Badge tone={k.status === 'valid' ? 'success' : k.status === 'invalid' ? 'danger' : 'neutral'}>
        {t(`ai.keyStatus.${k.status}`)}
      </Badge>
      {k.last4 && <span className="font-mono text-fg-2">{t('ai.endsWith', { last4: k.last4 })}</span>}
      {k.validatedAt && (
        <span className="text-fg-3">{t('ai.checked', { when: formatDateTime(k.validatedAt) })}</span>
      )}
    </p>
  );
}

/** Paste a key (never shown again), save and test it in one step; or remove it. */
function KeyForm({ target, k, label }: { target: AiKeyTarget; k: AiKeyView; label: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [key, setKey] = useState('');
  const [result, setResult] = useState<AiTestResult | null>(null);
  const save = useMutation({
    mutationFn: () =>
      api.put<{ result: AiTestResult; settings: AiSettingsView }>('/admin/ai/keys', {
        target,
        key: key.trim(),
      }),
    onSuccess: (r) => {
      setKey('');
      setResult(r.result);
      qc.setQueryData(['ai-settings'], r.settings);
      void qc.invalidateQueries({ queryKey: ['ai-status'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  const test = useMutation({
    mutationFn: () => api.post<AiTestResult>('/admin/ai/test', { target }),
    onSuccess: (r) => {
      setResult(r);
      void qc.invalidateQueries({ queryKey: ['ai-settings'] });
      void qc.invalidateQueries({ queryKey: ['ai-status'] });
    },
  });
  const remove = useMutation({
    mutationFn: () => api.delete<AiSettingsView>(`/admin/ai/keys/${target}`),
    onSuccess: (v) => {
      setResult(null);
      qc.setQueryData(['ai-settings'], v);
      void qc.invalidateQueries({ queryKey: ['ai-status'] });
    },
  });
  const shown = result ?? (k.error ? { ok: false, models: [], error: k.error } : null);
  return (
    <div className="grid gap-3">
      <KeyStatus k={k} />
      <form
        className="grid gap-2 sm:flex sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (key.trim()) save.mutate();
        }}
      >
        <div className="min-w-0 flex-1">
          <Field label={label} hint={t('ai.keyHint')}>
            {({ id, describedBy }) => (
              <PasswordInput
                id={id}
                aria-describedby={describedBy}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
                placeholder={k.last4 ? `•••• ${k.last4}` : ''}
              />
            )}
          </Field>
        </div>
        <Button type="submit" variant="primary" loading={save.isPending} disabled={!key.trim()}>
          <KeyRound className="size-4" aria-hidden /> {t('ai.saveAndTest')}
        </Button>
      </form>
      <div className="flex flex-wrap gap-2">
        {target !== 'youtube' && (
          <Button variant="outline" size="sm" loading={test.isPending} onClick={() => test.mutate()}>
            <PlugZap className="size-4" aria-hidden /> {t('ai.test')}
          </Button>
        )}
        {k.last4 && (
          <Button variant="ghost" size="sm" loading={remove.isPending} onClick={() => remove.mutate()}>
            <Trash2 className="size-4" aria-hidden /> {t('ai.removeKey')}
          </Button>
        )}
      </div>
      {shown && (
        <p
          role="status"
          className={cn(
            'flex items-start gap-2 rounded-[var(--radius-md)] p-3 text-meta',
            shown.ok ? 'bg-success-surface' : 'bg-danger-surface',
          )}
        >
          {shown.ok ? (
            <Check className="mt-0.5 size-4 flex-none text-success" aria-hidden />
          ) : (
            <CircleAlert className="mt-0.5 size-4 flex-none text-danger" aria-hidden />
          )}
          <span>{shown.ok ? t('ai.testOk', { count: shown.models.length }) : shown.error}</span>
        </p>
      )}
    </div>
  );
}

/** A model: chosen from the ones the key can use, or typed when the provider lists none. */
function ModelField({
  label,
  value,
  models,
  onChange,
}: {
  label: string;
  value: string;
  models: string[];
  onChange: (v: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Field label={label} hint={models.length ? undefined : t('ai.modelHint')}>
      {({ id, describedBy }) =>
        models.length ? (
          <Select
            id={id}
            aria-describedby={describedBy}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          >
            {!models.includes(value) && <option value={value}>{value || t('ai.chooseModel')}</option>}
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        ) : (
          <Input
            id={id}
            aria-describedby={describedBy}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="font-mono"
          />
        )
      }
    </Field>
  );
}

function NumberField({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      {({ id, describedBy }) => (
        <Input
          id={id}
          aria-describedby={describedBy}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Math.max(min, Math.min(max, Math.round(Number(e.target.value) || 0))))}
        />
      )}
    </Field>
  );
}

/**
 * Settings → AI Assistant (spec §7): the only step left for a college admin. Choose a provider,
 * paste a key (encrypted at rest; only its last four characters come back), test it, accept the
 * data-processing notice, then set limits and switches. Without any of it, members still get the
 * library, keyword search and passages from the material.
 */
export function AiAdmin() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery(aiSettings());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string>();
  const save = useMutation({
    mutationFn: (d: Draft) => api.put<AiSettingsView>('/admin/ai', d),
    onSuccess: (v) => {
      qc.setQueryData(['ai-settings'], v);
      setDraft(null);
      setError(undefined);
      void qc.invalidateQueries({ queryKey: ['ai-status'] });
      toast.success(t('common.saved'));
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  const consent = useMutation({
    mutationFn: (version: string) => api.post<AiSettingsView>('/admin/ai/consent', { version, accept: true }),
    onSuccess: (v) => {
      qc.setQueryData(['ai-settings'], v);
      void qc.invalidateQueries({ queryKey: ['ai-status'] });
      toast.success(t('ai.consentDone'));
    },
  });
  if (!q.data) return <Skeleton className="h-96 rounded-[var(--radius-lg)]" />;
  const v = q.data;
  const d = draft ?? toDraft(v);
  const set = (patch: Partial<Draft>) => setDraft({ ...d, ...patch });
  const dirty = draft !== null;
  const provider = v.providers.find((p) => p.id === d.chatProvider);
  const savedChat = v.chatProvider;
  const external =
    (savedChat && savedChat !== 'mock') || (v.embeddingProvider && v.embeddingProvider !== 'mock');
  const consentOk = v.consent?.version === v.consentVersion;
  const chatKeyNeeded = !!savedChat && v.providers.find((p) => p.id === savedChat)?.needsKey;
  const embedSeparate =
    !!v.embeddingProvider && v.embeddingProvider !== 'mock' && v.embeddingProvider !== v.chatProvider;

  const checklist: [string, boolean][] = [
    [t('ai.check.provider'), !!savedChat],
    [
      t('ai.check.key'),
      !!savedChat && (savedChat === 'mock' || v.keys.chat.status !== 'not_set' || !chatKeyNeeded),
    ],
    [t('ai.check.test'), savedChat === 'mock' || v.keys.chat.status === 'valid'],
    [t('ai.check.consent'), !external || consentOk],
    [t('ai.check.on'), v.status.answers],
  ];

  return (
    <div className="grid gap-5">
      <Card variant={v.status.answers ? 'featured' : 'raised'} className="grid gap-4 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <Sparkles className="size-6 text-brand-ink" aria-hidden />
          <h2 className="min-w-0 flex-1 text-title font-semibold">{t('ai.title')}</h2>
          <Badge tone={v.status.answers ? 'success' : 'neutral'}>
            {v.status.answers
              ? v.status.demo
                ? t('ai.onDemo')
                : t('ai.on')
              : t(`ai.reason.${v.status.reason ?? 'not_configured'}`)}
          </Badge>
        </div>
        <p className="text-meta text-fg-2">{t('ai.intro')}</p>
        <ol className="grid gap-2 sm:grid-cols-5" aria-label={t('ai.checklist')}>
          {checklist.map(([label, done], i) => (
            <li key={label} className="flex items-center gap-2 text-meta">
              <span
                className={cn(
                  'grid size-7 flex-none place-items-center rounded-full text-caption font-bold',
                  done ? 'bg-aurora text-on-aurora' : 'border border-line-strong text-fg-3',
                )}
                aria-hidden
              >
                {done ? <Check className="size-4" /> : i + 1}
              </span>
              <span className={done ? 'text-fg' : 'text-fg-2'}>
                {label}
                <span className="sr-only">{done ? ` (${t('common.stepDone')})` : ''}</span>
              </span>
            </li>
          ))}
        </ol>
        {v.platformDefault && !savedChat && <p className="text-meta text-fg-2">{t('ai.platformDefault')}</p>}
      </Card>

      <Section id="ai-provider" icon={<Sparkles />} title={t('ai.provider')}>
        <ChoiceGroup<AiProvider | typeof NONE>
          label={t('ai.provider')}
          value={d.chatProvider ?? NONE}
          columns={3}
          options={[
            { value: NONE, label: t('ai.providers.none'), detail: t('ai.providers.noneDetail') },
            ...v.providers.map((p) => ({
              value: p.id,
              label: t(`ai.providers.${p.id}`),
              detail: t(`ai.providers.${p.id}Detail`),
            })),
          ]}
          onChange={(id) =>
            set({
              chatProvider: id || null,
              chatModel: v.providers.find((p) => p.id === id)?.defaultChatModel ?? '',
            })
          }
        />
        {d.chatProvider && d.chatProvider !== savedChat && savedChat && (
          <p className="text-meta text-warning-ink" role="note">
            {t('ai.providerChangeWarning')}
          </p>
        )}
        {provider?.customEndpoint && (
          <Field label={t('ai.baseUrl')} hint={t('ai.baseUrlHint')}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                type="url"
                className="font-mono"
                placeholder="https://"
                value={d.baseUrl ?? ''}
                onChange={(e) => set({ baseUrl: e.target.value || null })}
              />
            )}
          </Field>
        )}
        {d.chatProvider && d.chatProvider !== 'mock' && (
          <ModelField
            label={t('ai.chatModel')}
            value={d.chatModel}
            models={d.chatProvider === savedChat ? v.keys.chat.models : []}
            onChange={(m) => set({ chatModel: m })}
          />
        )}
        {savedChat && savedChat !== 'mock' && savedChat === d.chatProvider && (
          <KeyForm
            target="chat"
            k={v.keys.chat}
            label={t('ai.apiKey', { provider: t(`ai.providers.${savedChat}`) })}
          />
        )}
        {d.chatProvider && d.chatProvider !== savedChat && (
          <p className="text-meta text-fg-2">{t('ai.saveFirst')}</p>
        )}
      </Section>

      <Section id="ai-embed" icon={<PlugZap />} title={t('ai.embeddings')}>
        <p className="text-meta text-fg-2">{t('ai.embeddingsIntro')}</p>
        <Field label={t('ai.embeddingProvider')}>
          {({ id }) => (
            <Select
              id={id}
              value={d.embeddingProvider ?? NONE}
              onChange={(e) =>
                set({
                  embeddingProvider: (e.target.value || null) as EmbeddingProvider | null,
                  embeddingModel: e.target.value === 'mock' ? 'mock-embed-1' : '',
                })
              }
            >
              <option value={NONE}>{t('ai.embeddingNone')}</option>
              {EMBEDDING_PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {t(`ai.providers.${p}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {d.embeddingProvider === 'openai_compatible' && (
          <Field label={t('ai.embeddingBaseUrl')} hint={t('ai.baseUrlHint')}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                type="url"
                className="font-mono"
                placeholder="https://"
                value={d.embeddingBaseUrl ?? ''}
                onChange={(e) => set({ embeddingBaseUrl: e.target.value || null })}
              />
            )}
          </Field>
        )}
        {d.embeddingProvider && d.embeddingProvider !== 'mock' && (
          <ModelField
            label={t('ai.embeddingModel')}
            value={d.embeddingModel}
            models={d.embeddingProvider === v.embeddingProvider ? v.keys.embedding.models : []}
            onChange={(m) => set({ embeddingModel: m })}
          />
        )}
        {embedSeparate && d.embeddingProvider === v.embeddingProvider && (
          <KeyForm
            target="embedding"
            k={v.keys.embedding}
            label={t('ai.apiKey', { provider: t(`ai.providers.${v.embeddingProvider}`) })}
          />
        )}
        {!embedSeparate && v.embeddingProvider && v.embeddingProvider !== 'mock' && (
          <KeyStatus k={v.keys.embedding} />
        )}
      </Section>

      <Section id="ai-consent" icon={<ShieldCheck />} title={t('ai.consent')}>
        <div className="grid gap-2 rounded-[var(--radius-md)] bg-surface-2 p-4 text-meta">
          <p className="font-semibold">{t('ai.consentTitle')}</p>
          <p className="text-fg-2">{t('ai.consentBody')}</p>
          <p className="text-fg-3">{t('ai.consentVersion', { version: v.consentVersion })}</p>
        </div>
        {consentOk && v.consent ? (
          <p className="flex items-center gap-2 text-meta text-success-ink">
            <Check className="size-4" aria-hidden />
            {t('ai.consentAccepted', { name: v.consent.by.name, when: formatDateTime(v.consent.acceptedAt) })}
          </p>
        ) : (
          <Button
            variant="primary"
            className="w-fit"
            loading={consent.isPending}
            onClick={() => consent.mutate(v.consentVersion)}
          >
            {t('ai.consentAccept')}
          </Button>
        )}
      </Section>

      <Section id="ai-limits" icon={<CircleAlert />} title={t('ai.limits')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField
            label={t('ai.monthlyBudget')}
            hint={t('ai.monthlyBudgetHint')}
            value={d.monthlyTokenBudget}
            min={0}
            max={1_000_000_000}
            onChange={(n) => set({ monthlyTokenBudget: n })}
          />
          <NumberField
            label={t('ai.dailyMessages')}
            value={d.dailyMessagesPerUser}
            min={1}
            max={500}
            onChange={(n) => set({ dailyMessagesPerUser: n })}
          />
          <NumberField
            label={t('ai.maxAnswerTokens')}
            value={d.maxAnswerTokens}
            min={128}
            max={4096}
            onChange={(n) => set({ maxAnswerTokens: n })}
          />
          <NumberField
            label={t('ai.maxChunks')}
            hint={t('ai.maxChunksHint')}
            value={d.maxChunks}
            min={2}
            max={20}
            onChange={(n) => set({ maxChunks: n })}
          />
          <NumberField
            label={t('ai.retention')}
            hint={t('ai.retentionHint')}
            value={d.chatRetentionDays}
            min={0}
            max={3650}
            onChange={(n) => set({ chatRetentionDays: n })}
          />
          <Field label={t('ai.temperature')} hint={t('ai.temperatureHint')}>
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={d.temperature === null ? '' : String(d.temperature)}
                onChange={(e) => set({ temperature: e.target.value === '' ? null : Number(e.target.value) })}
              >
                <option value="">{t('ai.temperatureDefault')}</option>
                {[0, 0.2, 0.4, 0.6, 0.8, 1].map((x) => (
                  <option key={x} value={String(x)}>
                    {x}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </Section>

      <Section id="ai-switches" icon={<Power />} title={t('ai.switches')}>
        <ul className="grid gap-1">
          {AI_FEATURES.map((f: AiFeature) => (
            <li key={f} className="rounded-[var(--radius-md)] bg-surface-2 px-3 py-1">
              <Switch
                label={t(`ai.feature.${f}`)}
                description={t(`ai.feature.${f}Detail`)}
                checked={d.features[f]}
                onChange={(on) => set({ features: { ...d.features, [f]: on } })}
              />
            </li>
          ))}
          <li className="rounded-[var(--radius-md)] bg-danger-surface px-3 py-1">
            <Switch
              label={t('ai.killSwitch')}
              description={t('ai.killSwitchDetail')}
              checked={d.killSwitch}
              onChange={(on) => set({ killSwitch: on })}
            />
          </li>
        </ul>
        {d.features.externalVideos && (
          <div className="grid gap-2 border-t border-line pt-4">
            <p className="text-meta text-fg-2">{t('ai.youtubeIntro')}</p>
            <KeyForm target="youtube" k={v.keys.youtube} label={t('ai.youtubeKey')} />
          </div>
        )}
      </Section>

      <div className="sticky bottom-[calc(84px+env(safe-area-inset-bottom,0px))] z-10 lg:bottom-4 grid gap-2 rounded-[var(--radius-lg)] border border-line bg-surface-1/95 p-3 shadow-elev-3 backdrop-blur sm:flex sm:items-center">
        <p className="min-w-0 flex-1 text-meta text-fg-2">{dirty ? t('ai.unsaved') : t('ai.allSaved')}</p>
        <FormError message={error} />
        {dirty && (
          <Button variant="ghost" onClick={() => setDraft(null)}>
            {t('common.cancel')}
          </Button>
        )}
        <Button variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(d)}>
          {t('ai.save')}
        </Button>
      </div>
    </div>
  );
}
