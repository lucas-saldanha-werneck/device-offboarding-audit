# device-offboarding-audit

Independent demo, not affiliated with Workwize.

A small command-line tool that compares an HR export with a laptop inventory and lists the rows that need a person to look at them. It has no dependencies and needs Node 20 or newer.

It checks for:

- departed_with_device: the employee is terminated, but a device is still assigned to them. The row is high severity once the end date is more than 3 days old.
- no_device_for_hire: an active employee starts within 14 days (or started in the last 30 days) and has no device.
- unknown_assignee: a device is assigned to an email that is not in the HR export.
- assigned_without_owner: status is `assigned` but nobody is named.
- duplicate_serial: the same serial number appears twice.
- bad_date: a date the tool cannot read, so it cannot age the row.

Emails are compared without case or surrounding spaces, because `Bruno.Costa@Example.com` and `bruno.costa@example.com` are the same person.

## Run it

```
node src/cli.js examples/employees.csv examples/devices.csv --today 2026-11-20
node src/cli.js employees.csv devices.csv --json
```

Options: `--today YYYY-MM-DD`, `--lead-days 14`, `--grace-days 3`, `--json`. Exit code is 1 when there is a high-severity finding, 0 when there is none, and 2 on bad input.

Input columns (header names are case-insensitive, extra columns are ignored):

- employees: `email, name, status` (`active` or `terminated`), `start_date`, `end_date`
- devices: `serial, model, assigned_to, status` (`assigned`, `in_stock`, `returned`, ...)

## Example data

Everything in `examples/` is invented. The addresses use `example.com`. Nothing comes from a real company or person.

Run on that data with `--today 2026-11-20`, the tool reports 9 findings. Bruno's laptop is one of them. A plain string comparison would miss it, because the inventory spells his email with different capitals.

## Tests

```
npm test
```

## What was tested

- 14 offline tests with `node --test`, no network.
- CSV parsing: quoted fields, escaped quotes, Windows line endings, blank lines, short rows.
- Each finding type, the grace and lead windows, email normalization, missing or invalid dates, missing columns, and sort order.
- A full run on the example files, checked finding by finding.
- The same tests and one CLI run on GitHub Actions (Ubuntu, Node 22).

## What was not tested

- Real HR or device-management exports. The column names are my guess at a common shape; a real system will need a small mapping step.
- Large files. The parser reads the whole file into memory.
- Time zones. Dates are plain `YYYY-MM-DD` and compared as UTC days.
- Other date formats, other status words, or statuses like "on leave".
- Any API integration. This reads two CSV files and does nothing else.
