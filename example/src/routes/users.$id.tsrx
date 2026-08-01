import type { RouteComponentProps } from 'riproute';

/** `users.$id.tsrx` and `users/$id.tsrx` produce the same route: `/users/:id`. */
export default function User(props: RouteComponentProps<'/users/:id'>) @{
	<h1>{`User ${props.params.id}`}</h1>
}
