exports.handler = async () => {
  return {
    statusCode: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    },
    body: JSON.stringify({ ok: true, function: 'vx-functions-health' })
  };
};
