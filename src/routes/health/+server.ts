const HEALTH_RESPONSE = Object.freeze({
	status: 'ok',
	service: 'dicechess-evaluation-playground',
});

export function GET(): Response {
	return Response.json(HEALTH_RESPONSE, {
		headers: {
			'cache-control': 'no-store',
		},
	});
}
