# CRM v2.0

A modern Customer Relationship Management system built with cutting-edge technologies.

## Getting Started

### Prerequisites
- Node.js 18+
- npm or yarn

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

### Build

```bash
npm run build
```

## Features

- Customer management
- Sales pipeline tracking
- Contact management
- Reporting and analytics

## IP access control

Restricts which networks each CRM user may sign in and work from. It ships
**off**: after migration `319_ip_access_control.sql` the master switch is off,
every user is set to *allow access from anywhere*, and there are no rules, so
nothing changes until a superadmin turns it on.

Manage it at **SuperAdmin → Access & Governance → IP Access**, or per person at
**User Control Center → IP Access**. Each user is either:

- **anywhere**, the default. They are never checked, even with the switch on.
- **restricted**. They may only connect from addresses their allow rules cover.
  Global rules, which apply to every restricted user, count too. Deny rules
  always win over allow rules.

Superadmins are never blocked, and this cannot be turned off.

### Enabling it safely

1. **Tell the backend about your proxies.** Behind nginx, Traefik (Coolify) or
   Cloudflare, the server sees the proxy's address rather than the user's.
   Set these in the backend environment and restart:

   ```bash
   IP_TRUSTED_PROXIES=127.0.0.1,10.0.0.0/8   # proxy IPs/CIDRs, or loopback / uniquelocal
   IP_CLIENT_HEADER=x-forwarded-for          # or cf-connecting-ip behind Cloudflare
   ```

   The forwarded header is only believed when the request comes straight from
   one of these proxies. When `IP_TRUSTED_PROXIES` is unset, no header is
   trusted, which is how the app has always behaved.
2. **Check your detected IP.** Open the IP Access screen and compare
   *Your connection* with a "what is my IP" site. Fix the proxy settings until
   they match. If they don't match, every user will look like they come from
   the proxy.
3. **Turn the switch on while nobody is restricted.** Nobody can be blocked yet.
   Logins and addresses start being recorded, so the users table fills in with
   each person's last seen IP.
4. **Restrict people one at a time.** Add a global allow rule for the office
   network, or use **Add current IP** on a user. Then switch that user off
   *anywhere*.

   The screen warns before you restrict someone with no allowed address, and
   it asks for an explicit "I understand" before saving anything that would
   block your own address.

Blocked attempts are logged under **Access attempts**. Successful logins are
logged too, but ordinary requests are not. Logs are pruned after 90 days,
which you can change on the same screen. Every change to the switch, a mode or
a rule is recorded in the change history.

### Recovering from a lockout

No login is needed. Run these on the server, from `backend/`:

```bash
npm run ip-access -- status              # what is on, who is restricted
npm run ip-access -- disable             # master switch OFF (live within 60s)
npm run ip-access -- anywhere someone@example.com   # one user back to "anywhere"
```

If the database itself is the problem, set `IP_RESTRICTION_FORCE_OFF=true` in
the backend environment and restart. That overrides the database switch.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License.
