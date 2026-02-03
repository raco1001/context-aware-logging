/**
 * Embedding Consistency Analyzer
 *
 * Analyzes the consistency between document embeddings and query embeddings
 * to ensure they are in the same vector space and format.
 */

export interface EmbeddingConsistencyReport {
  modelConsistency: {
    documentModel: string | null;
    queryModel: string | null;
    isConsistent: boolean;
  };
  formatConsistency: {
    documentFormat: string;
    queryFormat: string;
    fieldOrderMatch: boolean;
    fieldValueMapping: FieldMappingAnalysis;
  };
  recommendations: string[];
}

export interface FieldMappingAnalysis {
  outcome: { document: string; query: string; match: boolean };
  service: { document: string; query: string; match: boolean };
  route: { document: string; query: string; match: boolean };
  error: { document: string; query: string; match: boolean };
  errorMessage: { document: string; query: string; match: boolean };
  userRole: { document: string; query: string; match: boolean };
  latencyBucket: { document: string; query: string; match: boolean };
}

/**
 * Analyzes consistency between document summary format and query preprocessing format.
 */
export function analyzeFormatConsistency(
  documentSummary: string,
  queryPreprocessed: string,
): FieldMappingAnalysis {
  const docFields = parseSummaryFields(documentSummary);
  const queryFields = parseSummaryFields(queryPreprocessed);

  return {
    outcome: {
      document: docFields.outcome || '',
      query: queryFields.outcome || '',
      match:
        docFields.outcome === queryFields.outcome ||
        queryFields.outcome === 'ANY',
    },
    service: {
      document: docFields.service || '',
      query: queryFields.service || '',
      match:
        docFields.service === queryFields.service ||
        queryFields.service === 'ANY',
    },
    route: {
      document: docFields.route || '',
      query: queryFields.route || '',
      match:
        docFields.route === queryFields.route || queryFields.route === 'ANY',
    },
    error: {
      document: docFields.error || '',
      query: queryFields.error || '',
      match:
        docFields.error === queryFields.error ||
        queryFields.error === 'ANY' ||
        queryFields.error === 'NONE',
    },
    errorMessage: {
      document: docFields.errorMessage || '',
      query: queryFields.errorMessage || '',
      match:
        docFields.errorMessage === queryFields.errorMessage ||
        queryFields.errorMessage === 'ANY' ||
        queryFields.errorMessage === 'NONE',
    },
    userRole: {
      document: docFields.userRole || '',
      query: queryFields.userRole || '',
      match:
        docFields.userRole === queryFields.userRole ||
        queryFields.userRole === 'ANY',
    },
    latencyBucket: {
      document: docFields.latencyBucket || '',
      query: queryFields.latencyBucket || '',
      match:
        docFields.latencyBucket === queryFields.latencyBucket ||
        queryFields.latencyBucket === 'ANY',
    },
  };
}

/**
 * Parses a structured summary string into field values.
 */
function parseSummaryFields(summary: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const parts = summary.split(', ');

  for (const part of parts) {
    const colonIndex = part.indexOf(':');
    if (colonIndex > 0) {
      const fieldName = part.substring(0, colonIndex).trim();
      const fieldValue = part.substring(colonIndex + 1).trim();
      fields[fieldName.toLowerCase()] = fieldValue;
    }
  }

  return fields;
}

/**
 * Checks if field order matches between document and query formats.
 */
export function checkFieldOrder(
  documentSummary: string,
  queryPreprocessed: string,
): boolean {
  const docFields = extractFieldOrder(documentSummary);
  const queryFields = extractFieldOrder(queryPreprocessed);

  if (docFields.length !== queryFields.length) {
    return false;
  }

  return docFields.every((field, index) => field === queryFields[index]);
}

/**
 * Extracts field order from a structured summary.
 */
function extractFieldOrder(summary: string): string[] {
  const parts = summary.split(', ');
  return parts
    .map((part) => {
      const colonIndex = part.indexOf(':');
      return colonIndex > 0
        ? part.substring(0, colonIndex).trim().toLowerCase()
        : '';
    })
    .filter(Boolean);
}

/**
 * Generates a comprehensive consistency report.
 */
export function generateConsistencyReport(
  documentSummary: string,
  queryPreprocessed: string,
  documentModel: string | null = null,
  queryModel: string | null = null,
): EmbeddingConsistencyReport {
  const fieldMapping = analyzeFormatConsistency(
    documentSummary,
    queryPreprocessed,
  );
  const fieldOrderMatch = checkFieldOrder(documentSummary, queryPreprocessed);
  const modelConsistent = documentModel === queryModel;

  const recommendations: string[] = [];

  // Model consistency check
  if (!modelConsistent) {
    recommendations.push(
      `⚠️ Model mismatch: Document uses "${documentModel}" but query uses "${queryModel}". Use the same model for both.`,
    );
  }

  // Field order check
  if (!fieldOrderMatch) {
    recommendations.push(
      '⚠️ Field order mismatch: Document and query formats have different field orders. This may affect embedding similarity.',
    );
  }

  // Field mapping checks
  const mismatchedFields: string[] = [];
  Object.entries(fieldMapping).forEach(([field, analysis]) => {
    if (
      !analysis.match &&
      analysis.query !== 'ANY' &&
      analysis.query !== 'NONE'
    ) {
      mismatchedFields.push(field);
    }
  });

  if (mismatchedFields.length > 0) {
    recommendations.push(
      `⚠️ Field value mismatches detected in: ${mismatchedFields.join(', ')}. These fields may not match correctly in vector search.`,
    );
  }

  // Route field specific issue
  if (
    fieldMapping.route.query === 'ANY' &&
    fieldMapping.route.document !== ''
  ) {
    recommendations.push(
      "💡 Route field: Query always uses 'ANY' but documents have specific routes. Consider extracting route from query or using route-specific search.",
    );
  }

  // Success indicators
  if (modelConsistent && fieldOrderMatch && mismatchedFields.length === 0) {
    recommendations.push('✅ Format consistency looks good!');
  }

  return {
    modelConsistency: {
      documentModel,
      queryModel,
      isConsistent: modelConsistent,
    },
    formatConsistency: {
      documentFormat: documentSummary,
      queryFormat: queryPreprocessed,
      fieldOrderMatch,
      fieldValueMapping: fieldMapping,
    },
    recommendations,
  };
}
