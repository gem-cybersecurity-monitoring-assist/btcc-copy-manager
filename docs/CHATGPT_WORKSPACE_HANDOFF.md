undefined

### Auth configuration verified after staging

Secure Supabase GitHub sign-in succeeded in the Cloud Browser. In dedicated-project Auth settings, Site URL was saved as the protected preview branch alias above; exactly two `/copy-center` redirect URLs were saved for that alias and deployment `c6q32f6cu` (success toast: “Successfully added 2 URLs”). Confirm email remains ON, email provider ENABLED, anonymous sign-ins OFF and manual linking OFF. No production-project Auth settings were changed. New owner registration/confirmation is still outstanding.

The preview browser reaches Vercel Authentication. The owner selected Passkey in the secure login flow, but the page remained pending and a fresh verification tab still showed Vercel login; authentication is **not proven**. Keep deployment protection enabled and finish Vercel sign-in before opening `/account`. The protected connector GET already verified configured:true/authenticated:false, but it does not create an owner browser session. Never treat Supabase dashboard operator login as the GEM owner application login. After this gate, the owner must create the dedicated-project account directly; derive its new UUID from trusted confirmed Auth records before setting preview owner authorization or copying data. No password/hash migration or confirmation bypass is authorized.
