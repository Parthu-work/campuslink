import { useState } from 'react';
import { useTranslation } from '../../i18n/react';
import { Sheet } from '../../components/ui/dialog';

/**
 * One line under the composer (prompt 3, U8; A18 had three): where answers come from, the questions
 * left today only when under five, and How answers work in a sheet. `note` replaces the line when
 * the assistant is limited (AI off, the budget spent).
 */
export function TrustNote({
  scope,
  left = null,
  note,
}: {
  scope: 'study' | 'career';
  left?: number | null;
  note?: string | undefined;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <p className="flex flex-wrap items-center gap-x-2 text-caption text-fg-3">
        <span>{note ?? t(`ask.trust.${scope}`)}</span>
        {left !== null && left < 5 && (
          <span className="font-semibold text-fg-2">{t('ask.left', { count: left })}</span>
        )}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          className="inline-flex min-h-11 items-center font-semibold text-brand-ink hover:underline"
        >
          {t('ask.trust.more')}
        </button>
      </p>
      <Sheet open={open} onOpenChange={setOpen} title={t('ask.trust.title')}>
        <div className="grid gap-3 text-body text-fg-2">
          <p>{t('ask.trust.sources')}</p>
          <p>{t('ask.trust.refuse')}</p>
          <p>{t('ask.trust.mistakes')}</p>
          <p>{t('ask.trust.private')}</p>
        </div>
      </Sheet>
    </>
  );
}
