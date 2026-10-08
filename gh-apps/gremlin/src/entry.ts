import worker from './index.ts';
import { withGremlinOAuth } from './oauth.ts';

export default withGremlinOAuth(worker);
