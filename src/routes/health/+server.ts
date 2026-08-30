// SPDX-FileCopyrightText: 2026 Jegors Čemisovs
// SPDX-License-Identifier: AGPL-3.0-only

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
