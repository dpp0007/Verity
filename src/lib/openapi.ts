const err = { description: 'Error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
const ok = (ref: string, description = 'OK') => ({ description, content: { 'application/json': { schema: { $ref: `#/components/schemas/${ref}` } } } });
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string' } };

export const openapi = {
  openapi: '3.1.0',
  info: {
    title: 'Verity API', version: '1.0.0',
    description: 'Official-record verification and monitoring. Examples in this document are schema examples, not live registry data. Auth: browser sessions use an anonymous owner cookie; programmatic clients send `Authorization: Bearer <key>` where keys are configured in VERITY_API_KEYS.',
  },
  servers: [{ url: '/' }],
  security: [{ bearer: [] }, {}],
  paths: {
    '/api/v1/registries': { get: { summary: 'List registry coverage', responses: { 200: ok('RegistryList') } } },
    '/api/v1/verifications': {
      post: {
        summary: 'Create a verification (asynchronous)', description: 'Returns 202 with the verification in `queued` state. Poll GET /verifications/{id}. Send `Idempotency-Key` to make retries safe.',
        parameters: [{ name: 'Idempotency-Key', in: 'header', schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateVerification' }, example: { name: 'EXAMPLE NAME', subject_type: 'person', record_type: 'medical_license', country: 'US', region: 'CA', license_number: null, source_url: null } } } },
        responses: { 202: ok('Verification', 'Accepted'), 400: err, 422: err, 429: err },
      },
      get: { summary: 'List your verifications', responses: { 200: { description: 'OK' } } },
    },
    '/api/v1/verifications/{id}': { get: { summary: 'Retrieve a verification', parameters: [idParam], responses: { 200: ok('Verification'), 404: err } } },
    '/api/v1/verifications/{id}/select': {
      post: { summary: 'Choose a candidate when several records match', parameters: [idParam], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['candidate_id'], properties: { candidate_id: { type: 'string' } } } } } }, responses: { 202: ok('Verification'), 409: err } },
    },
    '/api/v1/verifications/{id}/retry': { post: { summary: 'Re-run a verification with the same inputs (new id)', parameters: [idParam], responses: { 202: ok('Verification'), 409: err } } },
    '/api/v1/monitors': {
      post: { summary: 'Create a TinyFish page monitor for a verified record', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['verification_id'], properties: { verification_id: { type: 'string' } } } } } }, responses: { 201: ok('Monitor', 'Created'), 409: err, 422: err, 502: err } },
      get: { summary: 'List monitors', responses: { 200: { description: 'OK' } } },
    },
    '/api/v1/monitors/{id}': {
      get: { summary: 'Get a monitor (reconciled with TinyFish)', parameters: [idParam], responses: { 200: ok('Monitor'), 404: err } },
      patch: { summary: 'Pause or resume', parameters: [idParam], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['status'], properties: { status: { enum: ['paused', 'active'] } } } } } }, responses: { 200: ok('Monitor'), 409: err } },
      delete: { summary: 'Remove the monitor (also deletes it at TinyFish)', parameters: [idParam], responses: { 204: { description: 'Removed' }, 404: err } },
    },
    '/api/v1/monitors/{id}/check': { post: { summary: 'Run a check now', parameters: [idParam], responses: { 200: ok('Monitor'), 409: err, 502: err } } },
    '/api/v1/activity': { get: { summary: 'Activity events and alerts', responses: { 200: { description: 'OK' } } } },
    '/api/v1/webhooks/tinyfish': {
      post: {
        summary: 'TinyFish monitor webhook receiver', description: 'Registered automatically as `?token=WEBHOOK_SECRET`. Deliveries are deduplicated on `fetch_monitor_id:id`. Body is the TinyFish Page Monitor payload (outcome: changed | unchanged | baseline).',
        security: [], responses: { 200: { description: 'Processed or duplicate' }, 401: err, 404: err },
      },
    },
  },
  components: {
    securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
    schemas: {
      Error: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, retryable: { type: 'boolean' }, details: {} } } } },
      CreateVerification: {
        type: 'object', required: ['name', 'subject_type', 'record_type', 'country'],
        properties: {
          name: { type: 'string' }, subject_type: { enum: ['person', 'business'] }, record_type: { enum: ['medical_license', 'contractor_license', 'company_registration'] },
          country: { type: 'string', minLength: 2, maxLength: 2 }, region: { type: ['string', 'null'] }, license_number: { type: ['string', 'null'] }, source_url: { type: ['string', 'null'], description: 'Must be https on the registry’s approved domain' },
        },
      },
      Verification: {
        type: 'object',
        properties: {
          id: { type: 'string' }, state: { enum: ['queued', 'running', 'awaiting_selection', 'completed', 'failed'] }, stage: { enum: ['finding_source', 'searching_registry', 'comparing_records', 'verifying_evidence', null] },
          subject: { type: 'object' },
          record: { type: ['object', 'null'], properties: { type: { type: 'string' }, number: { type: ['string', 'null'] }, status: { enum: ['active', 'expired', 'suspended', 'revoked', 'inactive', 'pending', 'not_found', 'unknown'] }, source_status: { type: ['string', 'null'] }, issue_date: { type: ['string', 'null'], format: 'date' }, expiry_date: { type: ['string', 'null'], format: 'date' }, disciplinary_actions: { type: ['array', 'null'], items: { type: 'string' } } } },
          jurisdiction: { type: 'object' },
          verification: { type: 'object', properties: { outcome: { enum: ['verified', 'partially_verified', 'ambiguous', 'not_found', 'unsupported', 'temporarily_unavailable', 'failed', null] }, confidence: { enum: ['high', 'medium', 'low', null] }, checked_at: { type: ['string', 'null'], format: 'date-time' }, source_name: { type: ['string', 'null'] }, source_url: { type: ['string', 'null'] }, evidence: { type: 'array' }, limitations: { type: 'array', items: { type: 'string' } } } },
          candidates: { type: 'array' }, history: { type: 'array' }, error: { type: ['object', 'null'] }, monitoring: { type: 'object' },
        },
      },
      Monitor: { type: 'object', properties: { id: { type: 'string' }, provider_monitor_id: { type: ['string', 'null'] }, status: { enum: ['creating', 'active', 'paused', 'failed'] }, current_status: { type: 'string' }, last_success_at: { type: ['string', 'null'] }, last_error: { type: ['string', 'null'] }, latest_alert: { type: ['object', 'null'] } } },
      RegistryList: { type: 'object', properties: { registries: { type: 'array' } } },
    },
  },
} as const;

export const ERROR_CODES: Array<[string, number, string]> = [
  ['validation_error', 400, 'Input failed validation'], ['invalid_json', 400, 'Body is not JSON'], ['invalid_api_key', 401, 'Bearer key not recognised'],
  ['not_found', 404, 'Unknown id or not yours'], ['invalid_state', 409, 'Operation not valid for current state'], ['monitor_exists', 409, 'Record is already monitored'],
  ['unsupported_jurisdiction', 422, 'No official registry configured for this place'], ['unsupported_record_type', 422, 'Record type not supported'],
  ['invalid_source_url', 422, 'URL not on the registry’s approved domain'], ['monitoring_unsupported', 422, 'Record cannot be monitored'],
  ['rate_limited', 429, 'Slow down and retry'], ['provider_*', 502, 'TinyFish call failed (auth, billing, unavailable, …)'], ['internal_error', 500, 'Unexpected server error'],
];
