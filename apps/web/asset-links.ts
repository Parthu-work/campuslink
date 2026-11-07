import type { Plugin } from 'vite';

/**
 * Digital Asset Links for the Android app (prompt 2, G9): /.well-known/assetlinks.json tells
 * Android the app may open this site full screen (a Trusted Web Activity). The same file serves
 * every host, the bare domain and each college, so it is part of the web build.
 *
 * Built only when ANDROID_PACKAGE_NAME and ANDROID_CERT_SHA256 are set (the SHA-256 fingerprints
 * of the app signing key, from Play Console › App integrity, comma-separated). Otherwise there is
 * no file and the path is a 404, which Android treats as "not linked".
 */
export function assetLinks(env: Record<string, string | undefined> = process.env): Plugin {
  return {
    name: 'campuslink-asset-links',
    apply: 'build',
    generateBundle() {
      const pkg = env.ANDROID_PACKAGE_NAME?.trim();
      const prints = (env.ANDROID_CERT_SHA256 ?? '')
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      if (!pkg || !prints.length) return;
      if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(pkg))
        throw new Error(`ANDROID_PACKAGE_NAME is not a package name: ${pkg}`);
      for (const p of prints)
        if (!/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(p))
          throw new Error(`ANDROID_CERT_SHA256 is not a SHA-256 fingerprint: ${p}`);
      this.emitFile({
        type: 'asset',
        fileName: '.well-known/assetlinks.json',
        source:
          JSON.stringify(
            [
              {
                relation: ['delegate_permission/common.handle_all_urls'],
                target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: prints },
              },
            ],
            null,
            2,
          ) + '\n',
      });
    },
  };
}
