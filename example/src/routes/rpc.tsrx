import { track } from 'ripple';
import { useFn } from 'riproute';
import { greet, listTodos } from '../lib/greeting.server';

/**
 * Server functions called from the browser. The imports above are the real
 * module during SSR and typed fetch stubs in the client bundle.
 */
export default function Rpc() @{
	let reply = track('');

	// The load-on-mount pattern: runs once hydrated (never during SSR), lands
	// in reactive state. `auto.value` is typed from greet's return.
	const auto = useFn(greet, 'effect');

	// An array result makes the hook iterable — `todo` is a `Todo`.
	const todos = useFn(listTodos);

	<div>
		<title append>{'server functions'}</title>
		<h1>{'Server functions'}</h1>
		<button
			onClick={async () => {
				const result = await greet('riproute');

				reply.value = `${result.message} via ${result.via}`;
			}}
		>{'Call greet()'}</button>
		<p id="rpc-reply">{reply.value}</p>
		<p id="rpc-auto">{auto.value === undefined ? '' : auto.value.message}</p>
		<ul id="rpc-todos">
			@for (const todo of todos; key todo.id) {
				<li>{todo.name}</li>
			}
		</ul>
	</div>
}
