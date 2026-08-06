import { track } from 'ripple';

/**
 * The index route.
 *
 * The counter is the hydration canary: it is server-rendered as `0`, and it
 * only increments if the client adopted the SSR markup instead of throwing it
 * away and mounting fresh.
 */
export default function Home() @{
	let count = track(0);

	<div>
		<title extend>{'home'}</title>
		<h1>{'Home'}</h1>
		<button onClick={() => count.value++}>{`count: ${count.value}`}</button>
	</div>
}
