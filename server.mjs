import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { WebSocketServer } from 'ws';
import { useServer } from 'graphql-ws/lib/use/ws';
import { PubSub } from 'graphql-subscriptions';
import express from 'express';
import http from 'http';
import cors from 'cors';
import bodyParser from 'body-parser';
import util from 'util';

const sleep = util.promisify(setTimeout);

// The GraphQL schema
const typeDefs = `#graphql
  type Post {
    author: String
    comment: String
  }

  type Subscription {
    hello: String
    postCreated: Post
  }

  # It is necessary.
  # Apollo doesn't run without it.
  type Query {
    fake: Boolean
  }
`;

const pubsub = new PubSub();

// A map of functions which return data for the schema.
const resolvers = {
  Subscription: {
    hello: {
      subscribe: async function* () {
        for await (const word of ['Hello', 'Bonjour', 'Ciao']) {
          yield { hello: word };
        }
      },
    },

    postCreated: {
      subscribe: () => pubsub.asyncIterator(['POST_CREATED']),
    },
  }
};

const app = express();
const httpServer = http.createServer(app);

const wsServer = new WebSocketServer({
  server: httpServer,
  path: '/graphql',
});

const schema = makeExecutableSchema({ typeDefs, resolvers });

const serverCleanup = useServer({ schema }, wsServer);

// Set up Apollo Server
const server = new ApolloServer({
  schema,
  plugins: [
    ApolloServerPluginDrainHttpServer({ httpServer }),
    {
      async serverWillStart() {
        return {
          async drainServer() {
            await serverCleanup.dispose();
          },
        };
      },
    },
  ],
});
await server.start();

app.use(
  '/graphql',
  cors(),
  bodyParser.json(),
  expressMiddleware(server),
);

const PORT = 4000;

await new Promise((resolve) => httpServer.listen({ port: PORT }, resolve));
console.log(`🚀 Server ready at http://localhost:${PORT}`);

while(true) {
  pubsub.publish('POST_CREATED', {
    postCreated: {
      author: 'Ali Baba',
      comment: 'Open sesame',
    },
  });

  await sleep(3000);
}
