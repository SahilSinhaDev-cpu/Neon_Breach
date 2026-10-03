import type { Context } from '@netlify/functions';
import { handleGame, STORE_NAME } from '../lib/authority';
import { createStrongStore } from '../lib/storage';

export default async function game(request: Request, context: Context) {
  // Netlify supplies Blobs credentials in its function runtime automatically.
  // No user-set environment variables, database provisioning, or API keys.
  return handleGame(request, createStrongStore(STORE_NAME), { ip: context.ip });
}
