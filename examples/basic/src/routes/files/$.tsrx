import type { RouteComponentProps } from '@riproute/router';

/** A bare `$` is a splat: `/files/*splat` matches the rest of the path. */
export default function Files(props: RouteComponentProps<'/files/*splat'>) @{
	<div>
		<title>{'Files'}</title>
		<h1>{`Files: ${props.params.splat}`}</h1>
	</div>
}
