# CampusLink for Android (prompt 2, G9)

A Trusted Web Activity: the web app, full screen, from the Play Store. There is no native code to
maintain; [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) generates the Android project
from `twa-manifest.json`.

- **One platform app.** It opens the bare domain (`https://campuslink.in/`), where the member types
  their college's address once (the college picker, remembered on the device). White-label builds
  per college can come later from the same file with another `packageId` and `host`.
- **Every college host is listed** in `additionalTrustedOrigins`, so a college's pages also open
  full screen. A new college needs a new release (until then its pages open in a Chrome tab with
  an address bar, which still works).
- **Digital Asset Links**: every host serves `/.well-known/assetlinks.json`, written by the web build
  when `ANDROID_PACKAGE_NAME` and `ANDROID_CERT_SHA256` are set (`apps/web/asset-links.ts`).

Build, sign and publish: [docs/android.md](../../docs/android.md). The keystore (`android.keystore`)
is never committed.
