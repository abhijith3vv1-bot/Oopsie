import { AlertCircle, CheckCircle2, Cloud } from 'lucide-react';
import { AssistantOrb } from './AssistantOrb';
import { useFirebaseAuth } from '../contexts/FirebaseContext';

export function AuthGateCard() {
  const { isSigningIn, authError, signInWithGoogle, enterGuestMode } = useFirebaseAuth();

  return (
    <div className="min-h-[100dvh] flex items-center justify-center px-4 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] bg-[#FAF9FC] dark:bg-[#12101A] text-[#24212B] dark:text-[#F5F3FA]">
      <div className="w-full max-w-md rounded-3xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] p-6 sm:p-8 shadow-sm space-y-6 text-center">
        <div className="flex flex-col items-center gap-3">
          <AssistantOrb mood="happy" size="lg" />
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#7657D5] dark:text-[#B9A7F5]">
              Oopsie · Never lose track of a conversation
            </p>
            <h1 className="text-2xl font-bold font-display tracking-tight text-[#24212B] dark:text-[#F5F3FA] text-balance">
              Save your follow-up assistant with Google
            </h1>
          </div>
          <p className="text-sm text-[#666173] dark:text-[#A7A2B8] leading-relaxed">
            Sign in with your Google account so your reminders, conversation timelines, and contacts stay safely stored and synced everywhere you open Oopsie.
          </p>
        </div>

        <div className="rounded-2xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] p-4 text-left space-y-2.5 text-xs text-[#666173] dark:text-[#A7A2B8]">
          <div className="flex items-center gap-2">
            <Cloud className="w-4 h-4 text-[#7657D5] dark:text-[#B9A7F5] shrink-0" />
            <span>Private cloud backup tied to your Google account</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>Keeps your existing reminders when you sign in</span>
          </div>
        </div>

        {authError && (
          <div className="flex items-start gap-2 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 p-3.5 text-left text-xs text-rose-700 dark:text-rose-300">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{authError}</span>
          </div>
        )}

        <div className="space-y-3">
          <button
            type="button"
            disabled={isSigningIn}
            onClick={() => void signInWithGoogle()}
            className="w-full min-h-[48px] inline-flex items-center justify-center gap-3 px-5 py-3 rounded-2xl bg-[#7657D5] hover:bg-[#6546C4] text-white text-sm font-semibold shadow-sm disabled:opacity-50 transition-colors"
          >
            <svg className="w-5 h-5 shrink-0 bg-white rounded-full p-0.5" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            <span>{isSigningIn ? 'Signing in...' : 'Continue with Google'}</span>
          </button>

          <button
            type="button"
            onClick={enterGuestMode}
            className="w-full min-h-[40px] px-4 py-2 text-xs font-medium text-[#666173] dark:text-[#A7A2B8] hover:text-[#24212B] dark:hover:text-[#F5F3FA] transition-colors"
          >
            Continue without an account (this device only)
          </button>
        </div>
      </div>
    </div>
  );
}
