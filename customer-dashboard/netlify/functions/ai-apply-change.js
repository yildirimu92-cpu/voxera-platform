'use strict';

const HEADERS = {
  'Access-Control-Allow-Origin': 'https://admin.voxera.ch',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: HEADERS, body: '' };
  }

  return {
    statusCode: 410,
    headers: HEADERS,
    body: JSON.stringify({
      error: 'This duplicate endpoint is disabled.',
      error_code: 'endpoint_disabled',
      canonical_endpoint: 'admin-panel/netlify/functions/ai-apply-change.js'
    })
  };
};
