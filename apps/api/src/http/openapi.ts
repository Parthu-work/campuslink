import { z } from 'zod';
import { API_PREFIX, APP_NAME, PERMISSIONS } from '@campuslink/shared';
import type { RouteRegistry } from './registry.js';

const toJson = (schema: z.ZodType) => z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });

/** OpenAPI 3.1 document generated from the same Zod schemas that validate requests. */
export function buildOpenApi(registry: RouteRegistry) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const { module, spec } of registry) {
    const path = API_PREFIX + spec.path.replace(/:(\w+)/g, '{$1}');
    const params: unknown[] = [];
    if (spec.params) {
      for (const [name, s] of Object.entries(
        (toJson(spec.params) as { properties?: Record<string, unknown> }).properties ?? {},
      )) {
        params.push({ name, in: 'path', required: true, schema: s });
      }
    }
    if (spec.query) {
      const js = toJson(spec.query) as { properties?: Record<string, unknown>; required?: string[] };
      for (const [name, s] of Object.entries(js.properties ?? {}))
        params.push({ name, in: 'query', required: js.required?.includes(name) ?? false, schema: s });
    }
    const access =
      spec.access.kind === 'permission'
        ? `Requires permission \`${spec.access.permission}\` (${PERMISSIONS[spec.access.permission]})`
        : spec.access.kind === 'authenticated'
          ? 'Any signed-in user'
          : 'Public';
    (paths[path] ??= {})[spec.method] = {
      tags: [spec.tag],
      summary: spec.summary,
      description: `${access}. Host scope: ${spec.scope ?? 'college'}.${spec.csrf ? ' Cookie-authenticated: send X-CSRF-Token.' : ''}${spec.limiter ? ` Rate limit: ${spec.limiter}.` : ''}`,
      operationId: `${module}_${spec.method}_${spec.path.replace(/[/:-]+/g, '_').replace(/^_|_$/g, '')}`,
      ...(spec.access.kind !== 'public' ? { security: [{ bearer: [] }] } : {}),
      ...(params.length ? { parameters: params } : {}),
      ...(spec.body
        ? { requestBody: { required: true, content: { 'application/json': { schema: toJson(spec.body) } } } }
        : {}),
      responses: {
        '2XX': { description: 'Success envelope { ok: true, data }' },
        '4XX': { description: 'Error envelope { ok: false, error: { code, message, requestId } }' },
      },
      'x-permission': spec.access.kind === 'permission' ? spec.access.permission : spec.access.kind,
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: `${APP_NAME} API`,
      version: '1.0.0',
      description:
        'Tenant is resolved from the request subdomain. All responses use the { ok, data | error } envelope.',
    },
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
    paths,
  };
}
