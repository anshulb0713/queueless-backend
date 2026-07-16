const uuidParameter = (name: string, description: string) => ({ name, in: 'path', required: true, description, schema: { type: 'string', format: 'uuid' } });
const branchId = uuidParameter('branchId', 'Branch UUID');
const tokenId = uuidParameter('tokenId', 'Token UUID');
const counterId = uuidParameter('counterId', 'Counter UUID');
const serviceId = uuidParameter('serviceId', 'Service UUID');
const staffId = uuidParameter('staffId', 'Staff UUID');
const staffAuth = [{ staffBearerAuth: [] }];
const adminAuth = [{ adminBearerAuth: [] }];
const customerAuth = [{ customerBearerAuth: [] }];
const body = (schema: object) => ({ required: true, content: { 'application/json': { schema } } });
const success = (description = 'Successful response') => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } }
});
const errors = { 400: { $ref: '#/components/responses/BadRequest' }, 401: { $ref: '#/components/responses/Unauthorized' }, 403: { $ref: '#/components/responses/Forbidden' }, 404: { $ref: '#/components/responses/NotFound' }, 409: { $ref: '#/components/responses/Conflict' } };
const operation = (summary: string, tags: string[], options: { security?: object[]; parameters?: object[]; requestBody?: object; successCode?: number; successDescription?: string } = {}) => ({
  summary,
  tags,
  ...(options.security ? { security: options.security } : {}),
  ...(options.parameters ? { parameters: options.parameters } : {}),
  ...(options.requestBody ? { requestBody: options.requestBody } : {}),
  responses: { [options.successCode ?? 200]: success(options.successDescription), ...errors }
});

export const openapiDocument = {
  openapi: '3.0.3',
  info: { title: 'QueueLess API', version: '1.0.0', description: 'Queue management API for customer, staff, and admin applications. All successful responses use `{ success: true, data }`; errors use `{ success: false, message, errorCode }`.' },
  servers: [{ url: '/api', description: 'Current QueueLess server' }],
  tags: [
    { name: 'System' }, { name: 'Authentication' }, { name: 'Customer' }, { name: 'Queue operations' }, { name: 'Staff' }, { name: 'Admin' }, { name: 'Branch and services' }, { name: 'Counters' }, { name: 'Dashboard' }, { name: 'Public display' }
  ],
  components: {
    securitySchemes: {
      adminBearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'JWT returned by `POST /auth/login` for an admin account.' },
      staffBearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'JWT returned by `POST /auth/login` for a staff account. Admin JWTs also work where staff access is allowed.' },
      customerBearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'Supabase access token', description: 'Google OAuth access token from Supabase Auth.' }
    },
    schemas: {
      SuccessResponse: { type: 'object', required: ['success', 'data'], properties: { success: { type: 'boolean', example: true }, message: { type: 'string' }, data: {} } },
      ErrorResponse: { type: 'object', required: ['success', 'message', 'errorCode'], properties: { success: { type: 'boolean', example: false }, message: { type: 'string' }, errorCode: { type: 'string', example: 'VALIDATION_ERROR' } } },
      LoginRequest: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string', format: 'email', example: 'staff@queueless.com' }, password: { type: 'string', format: 'password', example: 'staff123' } } },
      CustomerSessionRequest: { type: 'object', required: ['mobile'], properties: { mobile: { type: 'string', pattern: '^\\d{10,15}$', example: '9999999999' } } },
      TokenRequest: { type: 'object', required: ['branchId', 'serviceId'], properties: { branchId: { type: 'string', format: 'uuid' }, serviceId: { type: 'string', format: 'uuid' }, fcmToken: { type: 'string', nullable: true, description: 'Optional FCM registration token saved before the token is created.' } } },
      CounterReference: { type: 'object', required: ['counterId'], properties: { counterId: { type: 'string', format: 'uuid' } } },
      BranchRequest: { type: 'object', required: ['name', 'address'], properties: { name: { type: 'string', example: 'City Care Clinic' }, address: { type: 'string', example: 'Ahmedabad' }, status: { type: 'string', enum: ['open', 'closed'] } } },
      ServiceRequest: { type: 'object', required: ['branchId', 'name', 'prefix', 'averageDuration'], properties: { branchId: { type: 'string', format: 'uuid' }, name: { type: 'string', example: 'General Consultation' }, prefix: { type: 'string', example: 'A' }, averageDuration: { type: 'integer', minimum: 1, maximum: 240, example: 5 } } },
      CounterRequest: { type: 'object', required: ['branchId', 'name', 'serviceIds'], properties: { branchId: { type: 'string', format: 'uuid' }, name: { type: 'string', example: 'Counter 3' }, staffId: { type: 'string', format: 'uuid' }, serviceIds: { type: 'array', minItems: 1, items: { type: 'string', format: 'uuid' } } } },
      StaffRequest: { type: 'object', required: ['name', 'email', 'password'], properties: { name: { type: 'string', example: 'Alex Staff' }, email: { type: 'string', format: 'email' }, password: { type: 'string', format: 'password', minLength: 8 }, counterId: { type: 'string', format: 'uuid' } } },
      NotificationTokenRequest: { type: 'object', required: ['fcmToken'], properties: { fcmToken: { type: 'string', nullable: true, description: 'Set an FCM registration token, or null to remove it.' } } }
    },
    responses: {
      BadRequest: { description: 'Invalid request', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      Unauthorized: { description: 'Authentication failed or was missing', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      Forbidden: { description: 'The authenticated user cannot perform this action', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      NotFound: { description: 'Requested resource was not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      Conflict: { description: 'Action conflicts with current queue state', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
    }
  },
  paths: {
    '/health': { get: operation('Check API health', ['System']) },
    '/auth/login': { post: operation('Sign in an admin or staff user', ['Authentication'], { requestBody: body({ $ref: '#/components/schemas/LoginRequest' }) }) },
    '/auth/customer/session': { post: operation('Verify Google customer session and create/update profile', ['Authentication', 'Customer'], { security: customerAuth, requestBody: body({ $ref: '#/components/schemas/CustomerSessionRequest' }) }) },
    '/staff/assignment': { get: operation('Get the authenticated staff member’s assigned branch, counter, and services', ['Staff'], { security: staffAuth }) },
    '/admin/staff': { get: operation('List staff accounts and their counter assignments', ['Admin'], { security: adminAuth }), post: operation('Create a staff account', ['Admin'], { security: adminAuth, requestBody: body({ $ref: '#/components/schemas/StaffRequest' }), successCode: 201, successDescription: 'Staff user created' }) },
    '/admin/staff/{staffId}/counter': { patch: operation('Assign or unassign a staff member’s counter', ['Admin'], { security: adminAuth, parameters: [staffId], requestBody: body({ type: 'object', required: ['counterId'], properties: { counterId: { type: 'string', format: 'uuid', nullable: true } } }) }) },
    '/branches': { get: operation('List branches with waiting counts and estimated wait time', ['Branch and services']), post: operation('Create an open branch', ['Admin', 'Branch and services'], { security: adminAuth, requestBody: body({ $ref: '#/components/schemas/BranchRequest' }), successCode: 201, successDescription: 'Branch created' }) },
    '/branches/{branchId}': { get: operation('Get a branch', ['Branch and services'], { parameters: [branchId] }), put: operation('Update branch details or turn the branch on/off', ['Admin', 'Branch and services'], { security: adminAuth, parameters: [branchId], requestBody: body({ type: 'object', properties: { name: { type: 'string' }, address: { type: 'string' }, status: { type: 'string', enum: ['open', 'closed'] } }, minProperties: 1 }) }), delete: operation('Delete an empty branch and its empty child services/counters', ['Admin', 'Branch and services'], { security: adminAuth, parameters: [branchId] }) },
    '/branches/{branchId}/services': { get: operation('List services for a branch with waiting counts', ['Branch and services'], { parameters: [branchId] }) },
    '/services': { post: operation('Create a branch service', ['Admin', 'Branch and services'], { security: adminAuth, requestBody: body({ $ref: '#/components/schemas/ServiceRequest' }), successCode: 201, successDescription: 'Service created' }) },
    '/services/{serviceId}': { put: operation('Update a service name, prefix, duration, or status', ['Admin', 'Branch and services'], { security: adminAuth, parameters: [serviceId], requestBody: body({ type: 'object', properties: { name: { type: 'string' }, prefix: { type: 'string' }, averageDuration: { type: 'integer', minimum: 1, maximum: 240 }, status: { type: 'string', enum: ['active', 'inactive'] } }, minProperties: 1 }) }), delete: operation('Delete a service that has no token history', ['Admin', 'Branch and services'], { security: adminAuth, parameters: [serviceId] }) },
    '/tokens': { post: operation('Join a queue and create a token', ['Customer'], { security: customerAuth, requestBody: body({ $ref: '#/components/schemas/TokenRequest' }), successCode: 201, successDescription: 'Queue token created' }) },
    '/tokens/{tokenId}': { get: operation('Get the authenticated customer’s token', ['Customer'], { security: customerAuth, parameters: [tokenId] }) },
    '/tokens/{tokenId}/status': { get: operation('Get compact live status for the authenticated customer’s token', ['Customer'], { security: customerAuth, parameters: [tokenId] }) },
    '/customers/notification-token': { put: operation('Save or clear the customer FCM registration token', ['Customer'], { security: customerAuth, requestBody: body({ $ref: '#/components/schemas/NotificationTokenRequest' }) }) },
    '/tokens/{tokenId}/cancel': { patch: operation('Cancel the authenticated customer’s own waiting or called token', ['Customer'], { security: customerAuth, parameters: [tokenId] }) },
    '/queues/{branchId}': { get: operation('List queue tokens visible to the authenticated staff or admin user', ['Queue operations'], { security: staffAuth, parameters: [branchId, { name: 'serviceId', in: 'query', schema: { type: 'string', format: 'uuid' } }, { name: 'status', in: 'query', schema: { type: 'string', enum: ['waiting', 'called', 'serving', 'skipped', 'completed', 'cancelled'] } }] }) },
    '/queues/{branchId}/call-next': { post: operation('Call the next waiting token for an assigned service and counter', ['Queue operations'], { security: staffAuth, parameters: [branchId], requestBody: body({ type: 'object', required: ['serviceId', 'counterId'], properties: { serviceId: { type: 'string', format: 'uuid' }, counterId: { type: 'string', format: 'uuid' } } }) }) },
    '/tokens/{tokenId}/call': { patch: operation('Call a selected waiting token to a counter', ['Queue operations'], { security: staffAuth, parameters: [tokenId], requestBody: body({ $ref: '#/components/schemas/CounterReference' }) }) },
    '/tokens/{tokenId}/start': { patch: operation('Start service for a called token', ['Queue operations'], { security: staffAuth, parameters: [tokenId] }) },
    '/tokens/{tokenId}/complete': { patch: operation('Complete a serving token and free its counter', ['Queue operations'], { security: staffAuth, parameters: [tokenId] }) },
    '/tokens/{tokenId}/skip': { patch: operation('Skip a waiting or called token and free its counter if needed', ['Queue operations'], { security: staffAuth, parameters: [tokenId] }) },
    '/tokens/{tokenId}/restore': { patch: operation('Restore a skipped token to the waiting queue', ['Queue operations'], { security: staffAuth, parameters: [tokenId] }) },
    '/staff/tokens/{tokenId}/cancel': { patch: operation('Cancel a token as staff or admin and free its counter if needed', ['Queue operations'], { security: staffAuth, parameters: [tokenId] }) },
    '/counters': { get: operation('List counters; staff receive only their assigned counter', ['Counters'], { security: staffAuth, parameters: [{ name: 'branchId', in: 'query', schema: { type: 'string', format: 'uuid' } }] }), post: operation('Create a counter and assign services', ['Admin', 'Counters'], { security: adminAuth, requestBody: body({ $ref: '#/components/schemas/CounterRequest' }), successCode: 201, successDescription: 'Counter created' }) },
    '/counters/{counterId}': { put: operation('Update a counter name, staff assignment, or operational status', ['Admin', 'Counters'], { security: adminAuth, parameters: [counterId], requestBody: body({ type: 'object', properties: { name: { type: 'string' }, staffId: { type: 'string', format: 'uuid', nullable: true }, status: { type: 'string', enum: ['active', 'busy', 'paused', 'closed'] } }, minProperties: 1 }) }), delete: operation('Delete a counter that has no token history', ['Admin', 'Counters'], { security: adminAuth, parameters: [counterId] }) },
    '/counters/{counterId}/services': { put: operation('Replace the services available at a counter', ['Admin', 'Counters'], { security: adminAuth, parameters: [counterId], requestBody: body({ type: 'object', required: ['serviceIds'], properties: { serviceIds: { type: 'array', minItems: 1, items: { type: 'string', format: 'uuid' } } } }) }) },
    '/dashboard/summary': { get: operation('Get today’s queue summary scoped to the user’s role', ['Dashboard'], { security: staffAuth, parameters: [{ name: 'branchId', in: 'query', schema: { type: 'string', format: 'uuid' }, description: 'Required for staff users; optional for admins.' }] }) },
    '/dashboard/current-serving': { get: operation('Get called or serving tokens at the accessible counters', ['Dashboard'], { security: staffAuth, parameters: [{ name: 'branchId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } }] }) },
    '/dashboard/analytics': { get: operation('Get per-service completion and duration analytics', ['Dashboard'], { security: staffAuth, parameters: [{ name: 'branchId', in: 'query', schema: { type: 'string', format: 'uuid' }, description: 'Required for staff users; optional for admins.' }] }) },
    '/public-display/{branchId}': { get: operation('Get public now-serving and next-three queue data', ['Public display'], { parameters: [branchId] }) }
  }
} as const;

const clientOperations = new Set([
  'get /health',
  'post /auth/customer/session',
  'get /branches',
  'get /branches/{branchId}',
  'get /branches/{branchId}/services',
  'post /tokens',
  'get /tokens/{tokenId}',
  'get /tokens/{tokenId}/status',
  'put /customers/notification-token',
  'patch /tokens/{tokenId}/cancel',
  'get /public-display/{branchId}'
]);

const createAudienceDocument = (title: string, description: string, allowedOperations: Set<string>) => {
  const paths = Object.fromEntries(Object.entries(openapiDocument.paths).flatMap(([path, pathItem]) => {
    const operations = Object.fromEntries(Object.entries(pathItem).filter(([method]) => allowedOperations.has(`${method} ${path}`)));
    return Object.keys(operations).length ? [[path, operations]] : [];
  }));
  return {
    ...openapiDocument,
    info: { ...openapiDocument.info, title, description },
    paths
  };
};

export const clientOpenapiDocument = createAudienceDocument(
  'QueueLess Client API',
  'Customer mobile and public display APIs. Customer endpoints require a Supabase Google OAuth access token.',
  clientOperations
);

export const adminStaffOpenapiDocument = createAudienceDocument(
  'QueueLess Admin & Staff API',
  'Operations APIs for dashboard administrators and counter staff. Authenticate with the JWT returned by POST /auth/login.',
  new Set(Object.entries(openapiDocument.paths).flatMap(([path, pathItem]) => Object.keys(pathItem).map(method => `${method} ${path}`)).filter(operation => !clientOperations.has(operation)))
);
