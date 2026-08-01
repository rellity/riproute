import { rows } from '../data.server';

export default function Home() @{
	<h1>{`rows: ${rows.length}`}</h1>
}
