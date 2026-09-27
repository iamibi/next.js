import { fetchOptions } from "./fetch-options";

async function getRandom(id: string) {
  const res = await fetch(
    `https://next-data-api-endpoint.vercel.app/api/random?id=${id}`,
    fetchOptions,
  );
  return res.text();
}

export default async function Home() {
  const first = await getRandom("first");
  const second = await getRandom("second");

  return (
    <>
      <p id="first">{first}</p>
      <p id="second">{second}</p>
    </>
  );
}
