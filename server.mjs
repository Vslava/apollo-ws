import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { WebSocketServer } from 'ws';
import { useServer } from 'graphql-ws/lib/use/ws';
import { withFilter } from 'graphql-subscriptions';
import { AMQPPubSub } from 'graphql-amqp-subscriptions';
import amqp from 'amqplib';
import express from 'express';
import http from 'http';
import cors from 'cors';
import bodyParser from 'body-parser';

const typeDefs = `#graphql
  type Post {
    author: String
    comment: String
  }

  type Subscription {
    hello: String
    postCreated(authorsToFilter: [String!]): Post
  }

  type Mutation {
    createPost(author: String!, comment: String): Boolean
  }

  # It is necessary.
  # Apollo doesn't run without it.
  type Query {
    fake: Boolean
  }
`;

const pubsub = await amqp.connect('amqp://localhost').then(conn => {
  console.log('connected');

  return new AMQPPubSub({
    connection: conn
  });
}).catch(err => {
  console.error(err);
});

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
      subscribe: withFilter(
        () => pubsub.asyncIterator(['POST_CREATED']),
        (payload, variables) => {
          const authorInPayload = payload.postCreated.author;
          return variables?.authorsToFilter?.includes(authorInPayload);
        },
      ),
    },
  },
  Mutation: {
    createPost(parent, args) {
      pubsub.publish('POST_CREATED', { postCreated: args });
      console.log('createPost: ', JSON.stringify(args));
    },
  },
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

const PORT = process.env.PORT || 4000;

await new Promise((resolve) => httpServer.listen({ port: PORT }, resolve));
console.log(`🚀 Server ready at http://localhost:${PORT}`);
