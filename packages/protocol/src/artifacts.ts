import { chatSchemaArtifacts } from './chat/artifacts.js';
import { commonSchemaArtifacts } from './common/schemas.js';
import { identitySchemaArtifacts } from './identity/schemas.js';

export const schemaArtifacts = {
  chat: chatSchemaArtifacts,
  common: commonSchemaArtifacts,
  identity: identitySchemaArtifacts,
} as const;
