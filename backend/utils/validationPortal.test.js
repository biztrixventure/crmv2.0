// ============================================================================
// validationPortal.test.js -- the dialer IP-validation form, both generations.
//
// The markup below is the live form as each dialer serves it (fetched
// 2026-09-15), trimmed to the form. The point of the test is the thing that
// broke: the OLD code only knew the first page; the new one disguises the user
// field too and posts somewhere else. Both must fill exactly like a browser.
// ============================================================================
const { parseLoginForm, readOutcome } = require('./validationPortal');

// Old boxes (wavetech3new, tmcsolihp, ...): plain "userid", disguised password.
const OLD_PAGE = `
  <form method="POST" action="index.php" accept-charset="UTF-8">
    <input type="text" placeholder="User ID" autocomplete="off" id="userid" name="userid" value="">
    <input type="hidden" id="password" name="password"/>
    <input type="password" placeholder="Password" autocomplete="off" id="sCX84orl2tp" name="sCX84orl2tp">
    <input class="btn btn-full btn-yellow" type="submit" name="submit" value="SUBMIT">
  </form>`;

// New box (wavetech.flexodialer.com, valid8.php): BOTH fields disguised.
const NEW_PAGE = `
  <form action="valid8.php" method="post">
    <b>&nbsp;&nbsp;User ID</b><br>
    <input type="text" id="Jzr87Cp8XqJY" name="Jzr87Cp8XqJY" value="" class="w3-round">
    <br>
    <b>&nbsp;&nbsp;Password</b><br>
    <input type="hidden" id="password" name="password">
    <input type="password" id="WNK1WOrAvT1I" name="WNK1WOrAvT1I" value="" class="w3-round">
    <input type="submit" class="w3-btn" value="Submit" style="margin-left:47px" name="submit">
  </form>`;

describe('parseLoginForm', () => {
  test('old page: userid + disguised password, posts to index.php', () => {
    const f = parseLoginForm(OLD_PAGE, 'http://box.example:81/AkBSqt/index.php');
    expect(f.action).toBe('http://box.example:81/AkBSqt/index.php');
    expect(f.method).toBe('post');
    expect(f.userField).toBe('userid');
    expect(f.passField).toBe('sCX84orl2tp');
    // The empty decoy "password" goes back empty, exactly as a browser sends it.
    expect(f.carry).toEqual([['password', '']]);
    expect(f.submit).toEqual(['submit', 'SUBMIT']);
  });

  test('new page: disguised user field is found with no name hint at all', () => {
    const f = parseLoginForm(NEW_PAGE, 'http://wavetech.flexodialer.com:81/valid8.php');
    expect(f.action).toBe('http://wavetech.flexodialer.com:81/valid8.php');
    expect(f.userField).toBe('Jzr87Cp8XqJY');
    expect(f.passField).toBe('WNK1WOrAvT1I');
    expect(f.carry).toEqual([['password', '']]);
    expect(f.submit).toEqual(['submit', 'Submit']);
  });

  test('a relative action resolves against the page, not the site root', () => {
    const f = parseLoginForm(NEW_PAGE, 'http://h:81/some/dir/page.php');
    expect(f.action).toBe('http://h:81/some/dir/valid8.php');
  });

  test('hidden fields a page adds later (a token) ride along untouched', () => {
    const page = NEW_PAGE.replace('<input type="hidden" id="password" name="password">',
      '<input type="hidden" id="password" name="password"><input type="hidden" name="csrf" value="abc123">');
    const f = parseLoginForm(page, 'http://h:81/valid8.php');
    expect(f.carry).toEqual([['password', ''], ['csrf', 'abc123']]);
  });

  test('a page with no password field is not mistaken for the login form', () => {
    expect(parseLoginForm('<form action="x.php"><input name="q"></form>', 'http://h/')).toBeNull();
  });
});

describe('readOutcome', () => {
  test('new page success names the IP it opened', () => {
    const html = '<h5><center><font color="green"><b>Login Validated for<br>IP 203.0.113.7</b></font></center></h5>';
    expect(readOutcome(html)).toMatchObject({ said_success: true, said_failure: false, validated_ip: '203.0.113.7' });
  });

  test('the old "success" wording still counts', () => {
    expect(readOutcome('<p>IP address added successfully</p>').said_success).toBe(true);
  });

  test('a refused login is a failure, never a success', () => {
    const r = readOutcome('<b>Invalid User ID or Password</b>');
    expect(r.said_success).toBe(false);
    expect(r.said_failure).toBe(true);
    expect(r.message).toMatch(/Invalid/);
  });

  test('the bare form (nothing said) is neither', () => {
    expect(readOutcome(NEW_PAGE)).toMatchObject({ said_success: false, said_failure: false, validated_ip: null });
  });
});
