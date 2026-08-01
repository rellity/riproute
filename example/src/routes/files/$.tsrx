/** A bare `$` is a splat: `/files/*splat` matches the rest of the path. */
export default function Files(props: { params: Record<string, string> }) @{
	<div>
		<title>{'Files'}</title>
		<h1>{`Files: ${props.params.splat}`}</h1>
	</div>
}
