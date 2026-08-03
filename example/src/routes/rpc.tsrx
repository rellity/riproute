import { useMutateFn, useQueryFn } from 'riproute';
import { greet, listTodos } from '../lib/greeting.server';

/**
 * Server functions called from the browser. The imports above are the real
 * module during SSR and typed fetch stubs in the client bundle.
 */
export default function Rpc() @{
	// Load-on-mount: runs once hydrated (never during SSR), destructures
	// without losing reactivity. `data.value` is typed from greet's return;
	// arguments ride in options, or in a closure — both stay typed.
	const { data: auto } = useQueryFn(greet, { args: ['effect'] });

	// An array result makes `data` iterable — `todo` is a `Todo`.
	const { data: todos, loading } = useQueryFn(listTodos);

	// The write side: nothing runs until `mutate()` is called.
	const { mutate: callGreet, data: reply, loading: greeting } = useMutateFn(greet);

	<div>
		<title append>{'server functions'}</title>
		<h1>{'Server functions'}</h1>
		<button
			disabled={greeting.value}
			onClick={() => callGreet('riproute')}
		>{'Call greet()'}</button>
		<p id="rpc-reply">{
			reply.value === undefined ? '' : `${reply.value.message} via ${reply.value.via}`
		}</p>
		<p id="rpc-auto">{auto.value === undefined ? '' : auto.value.message}</p>
		<ul id="rpc-todos" data-loading={loading.value}>
			@for (const todo of todos; key todo.id) {
				<li>{todo.name}</li>
			}
		</ul>
	</div>
}
