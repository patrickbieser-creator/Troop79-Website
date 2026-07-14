import { loginAction } from './actions';
import { IS_DEV_DB } from '@/lib/dev-db';
import { createAdminClient } from '@/lib/supabase/server';
import { loadAuthorizedAdults } from '@/lib/authorized-adults';

export const metadata = {
  title: IS_DEV_DB ? '[DEV] Sign In — Troop 79 Admin' : 'Sign In — Troop 79 Admin'
};

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const errMessage =
    error === 'missing-username'
      ? 'Name is required.'
      : error === 'missing-password'
        ? 'Password is required.'
        : error === 'bad-password'
          ? 'That password isn’t right — check with the Scoutmaster.'
          : error === 'bad-username'
            ? 'That name isn’t on the authorized-adult list — check spelling, or use the scout password if you’re signing in as a scout.'
            : error === 'not-configured'
              ? 'Sign-in isn’t configured on this server (LEADER_PASSWORD is unset).'
              : null;
  const adults = await loadAuthorizedAdults(createAdminClient());

  return (
    <main
      style={{
        minHeight: '100vh',
        background: '#f5f6f8',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        fontFamily: 'var(--font-ui), Arial, sans-serif'
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          background: '#fff',
          border: '1px solid #e2e4e8',
          borderRadius: 6,
          boxShadow: '0 4px 16px rgba(0,0,0,.08)',
          padding: '28px 32px'
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '.14em',
            textTransform: 'uppercase',
            color: '#6d7580',
            marginBottom: 6
          }}
        >
          Troop 79 Admin
        </div>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 26,
            fontWeight: 700,
            color: '#1e3a4a',
            marginBottom: 8
          }}
        >
          Sign in
        </h1>
        <p
          style={{
            fontSize: 13,
            color: '#6d7580',
            marginBottom: 20,
            lineHeight: 1.5
          }}
        >
          Sign in with your name and the troop password. The leader password
          opens the full workspace; the scout password opens scout drafting.
        </p>

        <form action={loginAction}>
          {next && <input type="hidden" name="next" value={next} />}
          <Field
            label="Your name"
            name="username"
            placeholder="e.g. Patrick B."
            listId="adults-list"
          />
          <datalist id="adults-list">
            {adults.map((a) => (
              <option key={a.code} value={a.label} />
            ))}
          </datalist>
          <Field
            label="Troop password"
            name="password"
            type="password"
            placeholder=""
          />

          {errMessage && (
            <div
              role="alert"
              style={{
                fontSize: 12,
                color: '#c0392b',
                marginBottom: 12
              }}
            >
              {errMessage}
            </div>
          )}

          <button
            type="submit"
            style={{
              width: '100%',
              background: '#1e3a4a',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              padding: '11px 14px',
              fontWeight: 700,
              fontSize: 13,
              letterSpacing: '.04em',
              cursor: 'pointer'
            }}
          >
            Sign in
          </button>
        </form>

        <p
          style={{
            fontSize: 12,
            color: '#9ba1aa',
            marginTop: 20,
            textAlign: 'center'
          }}
        >
          <a href="/" style={{ color: '#3d7a4a', fontWeight: 600 }}>
            &larr; Back to public site
          </a>
        </p>
      </div>
    </main>
  );
}

function Field({
  label,
  name,
  type = 'text',
  placeholder,
  listId
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  listId?: string;
}) {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <span
        style={{
          display: 'block',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '.08em',
          textTransform: 'uppercase',
          color: '#3a3f47',
          marginBottom: 6
        }}
      >
        {label}
      </span>
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        list={listId}
        autoComplete={type === 'password' ? 'current-password' : 'username'}
        style={{
          width: '100%',
          border: '1px solid #cdd1d6',
          borderRadius: 4,
          padding: '9px 11px',
          fontSize: 14,
          fontFamily: 'inherit',
          outline: 'none'
        }}
      />
    </label>
  );
}
