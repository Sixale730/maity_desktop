const isDev = process.env.NODE_ENV === 'development';

export const logger = {
  // eslint-disable-next-line no-console
  debug: (...args: unknown[]) => { if (isDev) console.log(...args); },
  // eslint-disable-next-line no-console
  info: (...args: unknown[]) => { if (isDev) console.info(...args); },
  // eslint-disable-next-line no-console
  warn: (...args: unknown[]) => console.warn(...args),
  // eslint-disable-next-line no-console
  error: (...args: unknown[]) => console.error(...args),
};
