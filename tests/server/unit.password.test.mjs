// Password rules: length, a bundled list of common passwords, and the person's own email. No composition rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passwordProblem, MIN_LENGTH } from '../../api/_lib/password.js';

test('twelve characters or more', () => {
  assert.equal(MIN_LENGTH, 12);
  assert.equal(passwordProblem('Short1!'), 'too_short');
  assert.equal(passwordProblem('elevenchars'), 'too_short');
  assert.equal(passwordProblem(''), 'too_short');
  assert.equal(passwordProblem(undefined), 'too_short');
  assert.equal(passwordProblem('x'.repeat(73)), 'too_long');
});

test('no composition theatre: a long plain phrase is accepted, with or without digits, capitals or symbols', () => {
  for (const p of ['quiet harbor lamp window', 'orangebicyclemountainriver', 'tres tristes tigres comen trigo', 'Quiet-harbor-lamp-41', 'ñandú corre por la pampa']) {
    assert.equal(passwordProblem(p, 'person@example.com'), null, p);
  }
});

test('common passwords are refused, also when dressed up', () => {
  for (const p of ['password1234', 'Password1234', 'PASSWORD12345', 'passwordpassword', 'qwertyuiop12', 'Qwertyuiop!1', '123456789012', 'iloveyou1234', 'Welcome12345!', 'administrator1', 'P@ssw0rd1234', 'contraseña123', 'changeme1234', '1q2w3e4r5t6y', 'vyntexcommand1']) {
    assert.equal(passwordProblem(p), 'common', p);
  }
});

test('runs and repetitions are refused', () => {
  for (const p of ['aaaaaaaaaaaa', 'abababababab', 'abcabcabcabc', 'abcdefghijklmn', '987654321098'.slice(0, 9) + 'xyz' === '' ? '' : 'zyxwvutsrqpon', '0123456789:;']) {
    if (p) assert.ok(['pattern', 'common'].includes(passwordProblem(p)), p);
  }
});

test('a password built from the email address is refused', () => {
  assert.equal(passwordProblem('samantha.lopez-2026', 'samantha.lopez@example.com'), 'contains_email');
  assert.equal(passwordProblem('samantha.lopez@example.com', 'samantha.lopez@example.com'), 'contains_email');
  assert.equal(passwordProblem('XXsamantha.lopezXX', 'Samantha.Lopez@example.com'), 'contains_email');
  assert.equal(passwordProblem('quiet harbor lamp window', 'sam@example.com'), null, 'a very short name does not make ordinary words unusable');
});
