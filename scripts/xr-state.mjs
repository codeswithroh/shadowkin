// Prints window.__shadowkin.state() from the running app.
export default async function run({ page, frame }) {
  return (frame ?? page).evaluate(() => window.__shadowkin.state());
}
