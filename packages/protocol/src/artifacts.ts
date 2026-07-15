import { commonSchemaArtifacts } from './common/schemas.js';
import { identitySchemaArtifacts } from './identity/schemas.js';

export const schemaArtifacts = {
  common: commonSchemaArtifacts,
  identity: identitySchemaArtifacts,
} as const;
