const { createServerClient } = require('@supabase/ssr');

async function main() {
  const supabase = createServerClient(
    'https://tzungyasbhsdwojvbokc.supabase.co',
    'sb_publishable_NVLgzOjrQZl5IuB5R5ZLTA_BjvutyJx',
    {
      cookies: {
        getAll() {
          return [{ name: 'sb-tzungyasbhsdwojvbokc-auth-token', value: 'bad.jwt.token' }];
        },
        setAll() {}
      }
    }
  );
  try {
    const res = await supabase.auth.getUser();
    console.log("Response:", res);
  } catch (e) {
    console.error("Exception:", e);
  }
}
main();
