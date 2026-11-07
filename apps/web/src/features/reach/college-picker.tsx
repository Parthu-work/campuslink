import { useEffect, useState } from 'react';
import { Building2 } from 'lucide-react';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { Checkbox, Field, Input } from '../../components/ui/field';
import { Card } from '../../components/ui/misc';
import { prefs } from '../../lib/storage';

const SLUG = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/;
const collegeUrl = (slug: string) => `${location.protocol}//${slug}.${location.host}/`;

/**
 * The app's start screen on the bare domain (prompt 2, G9): the Android app opens here, and the
 * member types their college's address once. Nothing is looked up or listed: the college's own
 * address answers (or says no college lives there).
 */
export function CollegePicker() {
  const { t } = useTranslation();
  const [slug, setSlug] = useState('');
  const [remember, setRemember] = useState(true);
  const picking = new URLSearchParams(location.search).has('pick');
  useEffect(() => {
    const saved = prefs.get('college');
    if (saved && SLUG.test(saved) && !picking) location.replace(collegeUrl(saved));
  }, [picking]);
  const clean =
    slug
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .split('.')[0] ?? '';
  const valid = SLUG.test(clean);
  return (
    <Card
      variant="raised"
      className="grid w-full max-w-[420px] gap-4 p-6"
      role="region"
      aria-labelledby="picker-title"
    >
      <h1 id="picker-title" className="flex items-center gap-2 text-title font-semibold">
        <Building2 className="size-6 text-brand-ink" aria-hidden /> {t('reach.picker.title')}
      </h1>
      <p className="text-meta text-fg-2">{t('reach.picker.intro')}</p>
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          if (remember) prefs.set('college', clean);
          location.assign(collegeUrl(clean));
        }}
      >
        <Field label={t('reach.picker.label')} hint={t('reach.picker.hint', { example: 'dpit' })}>
          {({ id, describedBy }) => (
            <div className="flex items-center gap-2">
              <Input
                id={id}
                aria-describedby={describedBy}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="url"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
              />
              <span className="flex-none text-meta text-fg-3">.{location.host}</span>
            </div>
          )}
        </Field>
        <Checkbox id="remember-college" checked={remember} onChange={setRemember}>
          {t('reach.picker.remember')}
        </Checkbox>
        <Button type="submit" variant="primary" size="lg" disabled={!valid}>
          {t('reach.picker.go')}
        </Button>
      </form>
    </Card>
  );
}

/** On an address no college lives at: back to the picker on the bare domain. */
export function PickerLink() {
  const { t } = useTranslation();
  const root = location.host.split('.').slice(1).join('.');
  if (!root) return null;
  return (
    <a
      className="text-meta font-semibold text-brand-ink underline"
      href={`${location.protocol}//${root}/?pick=1`}
    >
      {t('reach.picker.other')}
    </a>
  );
}
