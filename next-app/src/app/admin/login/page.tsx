import { loginAction } from './actions';

export const metadata = {
  title: 'Sign In — Troop 79 Admin'
};

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const errMessage =
    error === 'missing-username' ? 'Username is required.' : null;

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
          Leader workspace access. Any username and password work in this
          build &mdash; real authentication is the next slice.
        </p>

        <form action={loginAction}>
          {next && <input type="hidden" name="next" value={next} />}
          <Field label="Username" name="username" placeholder="e.g. pbieser" />
          <Field
            label="Password"
            name="password"
            type="password"
            placeholder="(any password)"
          />

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
              I am a
            </span>
            <select
              name="role"
              defaultValue="leader"
              style={{
                width: '100%',
                border: '1px solid #cdd1d6',
                borderRadius: 4,
                padding: '9px 11px',
                fontSize: 14,
                fontFamily: 'inherit',
                outline: 'none',
                background: '#fff'
              }}
            >
              <option value="leader">Leader</option>
              <option value="scout">Scout</option>
            </select>
          </label>

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
  placeholder
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
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
