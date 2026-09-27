import Link from 'next/link'

export default function Home() {
  return (
    <ul>
      <li>
        <Link href="/with-registry">/with-registry</Link>
      </li>
      <li>
        <Link href="/without-registry">/without-registry</Link>
      </li>
    </ul>
  )
}
