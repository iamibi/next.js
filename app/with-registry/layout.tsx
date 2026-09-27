import StyleRegistry from '../style-registry'

export default function WithRegistryLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <StyleRegistry>{children}</StyleRegistry>
}
