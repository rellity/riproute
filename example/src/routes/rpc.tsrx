import { track } from 'ripple';
import { greet } from '../lib/greeting.server';

/**
 * A server function called from the browser. The import above is the real
 * module during SSR and a typed fetch stub in the client bundle.
 */
export default function Rpc() @{
	let reply = track('');

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
	</div>
}
