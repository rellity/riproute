import type { RouteComponentProps } from '@riproute/router';

/** `users.$id.tsrx` and `users/$id.tsrx` produce the same route: `/users/:id`. */
export default function User(props: RouteComponentProps<'/users/:id'>) @{
	<div>
		<title replace>{`User ${props.params.id}`}</title>
		<h1>{`User ${props.params.id}`}</h1>
	</div>
}
