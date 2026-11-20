'use client';

import { DoorOpen } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import type { Account, Session } from '../lib/api';
import styles from './AuthScreen.module.css';

type Mode = 'sign-in' | 'register';

const copy = {
  'sign-in': {
    title: 'Sign in',
    intro: 'Welcome back. Sign in to book rooms and manage your reservations.',
    submit: 'Sign in',
    busy: 'Signing in…',
    switchPrompt: 'New to Roomwell?',
    switchLink: 'Create an account',
    switchHref: '/register',
  },
  register: {
    title: 'Create an account',
    intro: 'Create an account to book meeting rooms at The Commons.',
    submit: 'Create account',
    busy: 'Creating account…',
    switchPrompt: 'Already have an account?',
    switchLink: 'Sign in',
    switchHref: '/sign-in',
  },
};

export function AuthScreen({ mode }: { mode: Mode }) {
  const router = useRouter();
  const text = copy[mode];

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Someone who is already signed in has nothing to do here.
  useEffect(() => {
    const request = new AbortController();

    api<Session>('/auth/me', { signal: request.signal })
      .then(({ account }) => {
        if (account) router.replace('/');
      })
      .catch(() => {
        // The form still works, so there's nothing to show.
      });

    return () => request.abort();
  }, [router]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');

    try {
      await api<Account>(
        mode === 'register' ? '/auth/register' : '/auth/login',
        {
          method: 'POST',
          body: JSON.stringify(
            mode === 'register'
              ? { name, email, password }
              : { email, password },
          ),
        },
      );

      router.replace('/');
    } catch (error) {
      setError(errorMessage(error));
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <Link href="/" className={styles.brand}>
        <span className={styles.mark}>
          <DoorOpen size={22} />
        </span>
        Roomwell
      </Link>

      <form className={styles.card} onSubmit={submit}>
        <div className={styles.heading}>
          <h1>{text.title}</h1>
          <p>{text.intro}</p>
        </div>

        {error && (
          <p className={styles.error + ' error'} role="alert">
            {error}
          </p>
        )}

        {mode === 'register' && (
          <label>
            Name
            <input
              name="name"
              autoComplete="name"
              required
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        )}

        <label>
          Email
          <input
            name="email"
            type="email"
            autoComplete={mode === 'register' ? 'email' : 'username'}
            required
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        <label>
          Password
          {mode === 'register' && <span>At least 8 characters</span>}
          <input
            name="password"
            type="password"
            autoComplete={
              mode === 'register' ? 'new-password' : 'current-password'
            }
            required
            minLength={mode === 'register' ? 8 : undefined}
            maxLength={mode === 'register' ? 128 : undefined}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        <button type="submit" className="primary" disabled={busy}>
          {busy ? text.busy : text.submit}
        </button>

        <p className={styles.switch}>
          {text.switchPrompt}{' '}
          <Link href={text.switchHref}>{text.switchLink}</Link>
        </p>
      </form>

      <Link href="/" className={styles.back}>
        Browse rooms without signing in
      </Link>
    </main>
  );
}
