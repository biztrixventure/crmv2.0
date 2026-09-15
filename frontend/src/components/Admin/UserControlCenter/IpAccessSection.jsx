// IpAccessSection -- this user's IP access (mig 319), inside the User Control
// Center. The same panel the IP Access tab opens from its users table, so the
// two views can never disagree. scope:'user' -- it follows the person across
// every company, like the login itself.
import UserIpAccessPanel from '../IpAccess/UserIpAccessPanel';

export default function IpAccessSection({ account }) {
  if (!account?.user_id) return null;
  return <UserIpAccessPanel userId={account.user_id} />;
}
