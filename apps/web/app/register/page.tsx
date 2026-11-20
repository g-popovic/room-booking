import type { Metadata } from 'next';
import { AuthScreen } from '../components/AuthScreen';

export const metadata: Metadata = { title: 'Create an account — Roomwell' };

export default function Register() {
  return <AuthScreen mode="register" />;
}
