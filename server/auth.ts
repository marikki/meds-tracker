import express, { type NextFunction, type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Авторизація лише для окремого застосунку. У FamilyHub цей файл не переїжджає:
 * там роутер модуля монтується за його власним JWT-middleware.
 *
 * Користувачі з ENV, як у FamilyHub:
 *   PASSWORD_MARINA=...   → id "marina"
 *   NAME_MARINA=Марина    → відображуване ім'я (необов'язково)
 */
export interface AuthUser {
  id: string;
  name: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const COOKIE = 'meds_token';
const TTL_DAYS = 30;

export function usersFromEnv(env = process.env): (AuthUser & { password: string })[] {
  return Object.entries(env)
    .filter(([k, v]) => k.startsWith('PASSWORD_') && v)
    .map(([k, password]) => {
      const key = k.slice('PASSWORD_'.length);
      return { id: key.toLowerCase(), name: env[`NAME_${key}`] || key, password: password! };
    });
}

// Порівняння через хеш: однакова довжина буферів і постійний час
const sameSecret = (a: string, b: string) =>
  timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

export function createAuth(secret: string, users: (AuthUser & { password: string })[], secure: boolean) {
  const router = express.Router();
  router.use(express.json());

  router.post('/login', (req, res) => {
    const { user, password } = req.body ?? {};
    const found = users.find((u) => u.id === String(user ?? '').toLowerCase());
    if (!found || typeof password !== 'string' || !sameSecret(password, found.password)) {
      return res.status(401).json({ error: 'Неверное имя или пароль' });
    }
    const token = jwt.sign({ sub: found.id }, secret, { expiresIn: `${TTL_DAYS}d` });
    res.cookie(COOKIE, token, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      maxAge: TTL_DAYS * 86_400_000,
    });
    res.json({ id: found.id, name: found.name });
  });

  router.post('/logout', (_req, res) => {
    res.clearCookie(COOKIE).status(204).end();
  });

  function requireAuth(req: Request, res: Response, next: NextFunction) {
    try {
      const { sub } = jwt.verify(req.cookies?.[COOKIE] ?? '', secret) as { sub: string };
      const u = users.find((x) => x.id === sub);
      if (!u) throw new Error('unknown user');
      req.user = { id: u.id, name: u.name };
      next();
    } catch {
      res.status(401).json({ error: 'Нужен вход' });
    }
  }

  router.get('/me', requireAuth, (req, res) => {
    res.json(req.user);
  });

  return { router, requireAuth };
}
