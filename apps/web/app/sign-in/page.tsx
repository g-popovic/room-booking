import type { Metadata } from 'next';
import { AuthScreen } from '../components/AuthScreen';

export const metadata: Metadata = { title: 'Sign in — Roomwell' };

export default function SignIn() {
  return <AuthScreen mode="sign-in" />;
}
