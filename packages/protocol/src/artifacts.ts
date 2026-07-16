import { chatSchemaArtifacts } from './chat/artifacts.js';
import { commonSchemaArtifacts } from './common/schemas.js';
import { identitySchemaArtifacts } from './identity/schemas.js';

export const schemaArtifacts = {
  admin: adminSchemaArtifacts,
  chat: chatSchemaArtifacts,
  common: commonSchemaArtifacts,
  identity: identitySchemaArtifacts,
} as const;
import { adminSchemaArtifacts } from './admin/artifacts.js';
