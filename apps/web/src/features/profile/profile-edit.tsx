import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '../../lib/toast';
import { Camera, Plus, Trash2 } from 'lucide-react';
import { AUDIENCES, type Audience, type ProfileField, type PublicProfile } from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { Field, Input, Select, Textarea } from '../../components/ui/field';
import { Card, Skeleton } from '../../components/ui/misc';
import { TagInput } from '../../components/ui/tag-input';
import { OtpInput } from '../../components/ui/otp';
import { PersonAvatar } from '../../components/ui/person-avatar';
import { FormError } from '../../components/layout/auth-layout';
import { api, ApiError } from '../../lib/api';
import { useMe } from '../../lib/me';
import { useTenant } from '../../lib/tenant-context';

interface Mine {
  profile: PublicProfile;
  visibility: Record<ProfileField, Audience>;
}
type Link = { label: 'linkedin' | 'github' | 'portfolio' | 'other'; url: string };
interface FormState {
  headline: string;
  company: string;
  jobTitle: string;
  location: string;
  bio: string;
  skills: string[];
  topics: string[];
  languages: string[];
  phone: string;
  links: Link[];
}

function guessLabel(url: string): Link['label'] {
  return /linkedin\./.test(url) ? 'linkedin' : /github\./.test(url) ? 'github' : 'portfolio';
}

function toForm(m: Mine): FormState {
  const f = m.profile.fields;
  return {
    headline: f.headline ?? '',
    company: f.company ?? '',
    jobTitle: f.jobTitle ?? '',
    location: f.location ?? '',
    bio: f.bio ?? '',
    skills: f.skills ?? [],
    topics: f.topics ?? [],
    languages: f.languages ?? [],
    phone: f.phone ?? '',
    links: (f.links ?? []) as Link[],
  };
}

export function ProfileEdit() {
  const mine = useQuery({ queryKey: ['my-profile'], queryFn: () => api.get<Mine>('/me/profile') });
  if (!mine.data) return <Skeleton className="h-96" />;
  return <ProfileForm initial={mine.data} />;
}

function ProfileForm({ initial }: { initial: Mine }) {
  const { t } = useTranslation();
  const tenant = useTenant();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const mine = useQuery({
    queryKey: ['my-profile'],
    queryFn: () => api.get<Mine>('/me/profile'),
    initialData: initial,
  });
  const [form, setForm] = useState<FormState>(() => toForm(initial));
  const [vis, setVis] = useState<Record<ProfileField, Audience>>(() => initial.visibility);
  const [error, setError] = useState<string>();
  const photoInput = useRef<HTMLInputElement>(null);

  const save = useMutation({
    mutationFn: () =>
      api.put<Mine>('/me/profile', {
        ...form,
        links: form.links.filter((l) => l.url.trim()),
        visibility: vis,
      }),
    onSuccess: (d) => {
      qc.setQueryData(['my-profile'], d);
      setError(undefined);
      toast.success(t('profile.saved'));
    },
    onError: (e: Error) =>
      setError(
        e instanceof ApiError && Array.isArray(e.details)
          ? `${e.message}: ${(e.details as { path: string; message: string }[]).map((d) => `${d.path} – ${d.message}`).join('; ')}`
          : e.message,
      ),
  });
  const photo = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.set('photo', file);
      return api.upload<{ avatarFileId: string }>('/me/avatar', fd);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['my-profile'] });
      toast.success(t('profile.photoSaved'));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm({ ...form, [k]: v });
  const audience = (field: ProfileField) => (
    <label className="flex items-center gap-2 text-xs text-fg-2">
      <span className="flex-none">{t('profile.visibility')}</span>
      <Select
        value={vis[field]}
        onChange={(e) => setVis({ ...vis, [field]: e.target.value as Audience })}
        className="min-h-9 py-0 text-sm"
      >
        {AUDIENCES.map((a) => (
          <option key={a} value={a}>
            {t(`profile.aud.${a}`, { college: tenant.branding.shortName })}
          </option>
        ))}
      </Select>
    </label>
  );
  const p = mine.data.profile;

  return (
    <>
      <h1 className="text-[clamp(26px,4vw,34px)] font-bold">{t('profile.title')}</h1>
      <Card className="flex flex-wrap items-center gap-4 p-5">
        <PersonAvatar name={p.name} fileId={p.avatarFileId} size={72} verified={p.verified} />
        {/* A real basis, so on phones the button wraps below instead of crushing the name (TY-1). */}
        <div className="min-w-0 flex-1 basis-48">
          <b className="block text-lg">{p.name}</b>
          {(p.fields.branch || p.fields.gradYear) && (
            <p className="text-sm text-fg-2">
              {[p.fields.branch, p.fields.gradYear].filter(Boolean).join(' · ')}{' '}
              <span className="text-fg-3">({t('profile.fromList')})</span>
            </p>
          )}
        </div>
        <input
          ref={photoInput}
          aria-label={t('profile.changePhoto')}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => e.target.files?.[0] && photo.mutate(e.target.files[0])}
        />
        <Button onClick={() => photoInput.current?.click()} loading={photo.isPending}>
          <Camera className="size-4" aria-hidden /> {t('profile.changePhoto')}
        </Button>
      </Card>

      <Card className="p-5">
        <form
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <FormError message={error} />
          <div className="grid gap-2">
            <Field label={t('profile.headline')} hint={t('profile.headlineHint')}>
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  value={form.headline}
                  maxLength={120}
                  onChange={(e) => set('headline', e.target.value)}
                />
              )}
            </Field>
            {audience('headline')}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Field label={t('profile.company')}>
                {({ id }) => (
                  <Input
                    id={id}
                    value={form.company}
                    maxLength={80}
                    onChange={(e) => set('company', e.target.value)}
                  />
                )}
              </Field>
              {audience('company')}
            </div>
            <div className="grid gap-2">
              <Field label={t('profile.jobTitle')}>
                {({ id }) => (
                  <Input
                    id={id}
                    value={form.jobTitle}
                    maxLength={80}
                    onChange={(e) => set('jobTitle', e.target.value)}
                  />
                )}
              </Field>
              {audience('jobTitle')}
            </div>
          </div>
          <div className="grid gap-2">
            <Field label={t('profile.location')}>
              {({ id }) => (
                <Input
                  id={id}
                  value={form.location}
                  maxLength={80}
                  onChange={(e) => set('location', e.target.value)}
                />
              )}
            </Field>
            {audience('location')}
          </div>
          <div className="grid gap-2">
            <Field label={t('profile.bio')}>
              {({ id }) => (
                <Textarea
                  id={id}
                  value={form.bio}
                  maxLength={1000}
                  rows={4}
                  onChange={(e) => set('bio', e.target.value)}
                />
              )}
            </Field>
            {audience('bio')}
          </div>
          {(['skills', 'topics', 'languages'] as const).map((k) => (
            <div key={k} className="grid gap-2">
              <TagInput
                label={t(`profile.${k}`)}
                hint={t('profile.tagHint')}
                value={form[k]}
                onChange={(v) => set(k, v)}
                max={k === 'languages' ? 8 : 20}
              />
              {audience(k)}
            </div>
          ))}
          <fieldset className="grid gap-2">
            <legend className="mb-1.5 text-[13px] font-semibold">{t('profile.links')}</legend>
            {form.links.map((l, i) => (
              <div key={i} className="flex gap-2">
                <label className="sr-only" htmlFor={`link-${i}`}>
                  {t('profile.linkUrl')}
                </label>
                <Input
                  id={`link-${i}`}
                  value={l.url}
                  placeholder={t('profile.linkUrl')}
                  type="url"
                  onChange={(e) =>
                    set(
                      'links',
                      form.links.map((x, j) =>
                        j === i ? { url: e.target.value, label: guessLabel(e.target.value) } : x,
                      ),
                    )
                  }
                />
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t('profile.removeLink')}
                  onClick={() =>
                    set(
                      'links',
                      form.links.filter((_, j) => j !== i),
                    )
                  }
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
            ))}
            {form.links.length < 5 && (
              <Button
                size="sm"
                className="justify-self-start"
                onClick={() => set('links', [...form.links, { label: 'portfolio', url: '' }])}
              >
                <Plus className="size-4" aria-hidden /> {t('profile.addLink')}
              </Button>
            )}
            {audience('links')}
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Field label={t('profile.email')}>
                {({ id }) => <Input id={id} value={me?.email ?? ''} readOnly className="text-fg-2" />}
              </Field>
              {audience('email')}
            </div>
            <div className="grid gap-2">
              <Field label={t('profile.phone')}>
                {({ id }) => (
                  <Input
                    id={id}
                    value={form.phone}
                    inputMode="tel"
                    autoComplete="tel"
                    onChange={(e) => set('phone', e.target.value)}
                  />
                )}
              </Field>
              {audience('phone')}
            </div>
          </div>
          <Button type="submit" variant="primary" className="justify-self-start" loading={save.isPending}>
            {t('common.save')}
          </Button>
        </form>
      </Card>
      {me?.roles.includes('ALUMNI') && me.verified && <CompanyBadge current={p.companyVerified} />}
    </>
  );
}

function CompanyBadge({ current }: { current: PublicProfile['companyVerified'] }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [challenge, setChallenge] = useState<{ id: string; destination: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('errors.generic'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="grid gap-3 p-5">
      <h2 className="text-lg font-semibold">{t('profile.companyTitle')}</h2>
      <p className="text-sm text-fg-2">{t('profile.companyBody')}</p>
      {current && (
        <p className="text-sm font-semibold text-success">
          {t('profile.companyDone', { company: current.company })}
        </p>
      )}
      <FormError message={error} />
      {!challenge ? (
        <form
          className="grid max-w-md gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const r = await api.post<{ challengeId: string; destination: string }>(
                '/verification/company',
                { email, company },
              );
              setChallenge({ id: r.challengeId, destination: r.destination });
            });
          }}
        >
          <Field label={t('profile.company')}>
            {({ id }) => (
              <Input
                id={id}
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                required
                minLength={2}
              />
            )}
          </Field>
          <Field label={t('profile.workEmail')}>
            {({ id }) => (
              <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            )}
          </Field>
          <Button type="submit" loading={busy} className="justify-self-start">
            {t('profile.sendCode')}
          </Button>
        </form>
      ) : (
        <form
          className="grid max-w-md gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api.post('/verification/company/confirm', { challengeId: challenge.id, code });
              setChallenge(null);
              setCode('');
              await qc.invalidateQueries({ queryKey: ['my-profile'] });
            });
          }}
        >
          <p className="text-sm" role="status">
            {t('verify.codeSent', { destination: challenge.destination })}
          </p>
          <OtpInput value={code} onChange={setCode} label={t('verify.codeTitle')} />
          <Button
            type="submit"
            variant="primary"
            loading={busy}
            disabled={code.length !== 6}
            className="justify-self-start"
          >
            {t('verify.confirm')}
          </Button>
        </form>
      )}
    </Card>
  );
}
