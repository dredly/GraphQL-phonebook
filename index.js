if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

const jwt = require("jsonwebtoken");
const {
  ApolloServer,
  UserInputError,
  AuthenticationError,
} = require("apollo-server");
const typeDefs = require("./typeDefs");
const { v1: uuid } = require("uuid");
const mongoose = require("mongoose");
const Person = require("./models/person");
const User = require("./models/user");
const person = require("./models/person");

const JWT_SECRET = process.env.JWT_SECRET;

const MONGODB_URI = process.env.MONGODB_URI;
console.log("Connecting to", MONGODB_URI);

mongoose
  .connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => {
    console.log("Connected to MongoDB!");
  })
  .catch((err) => {
    console.log("Error connecting to mongodb", err.message);
  });

const resolvers = {
  Query: {
    personCount: async () => Person.collection.countDocuments(),
    allPersons: async (root, args) => {
      if (!args.phone) {
        return Person.find({});
      }
      return Person.find({ phone: { $exists: args.phone === "YES" } });
    },
    findPerson: async (root, args) => Person.findOne({ name: args.name }),
    me: (root, args, context) => context.currentUser,
  },
  Person: {
    address: (root) => {
      return {
        street: root.street,
        city: root.city,
      };
    },
  },
  Mutation: {
    addPerson: async (root, args, context) => {
      const person = new Person({ ...args });
      const currentUser = context.currentUser;

      if (!currentUser) {
        throw new AuthenticationError("not authenticated");
      }

      try {
        await person.save();
        currentUser.friends = currentUser.friends.concat(person);
        await currentUser.save();
      } catch (err) {
        throw new UserInputError(err.message, {
          invalidArgs: args,
        });
      }
      return person;
    },
    addAsFriend: async (root, args, { currentUser }) => {
      const nonFriendAlready = (person) =>
        !currentUser.friends
          .map((f) => f._id.toString())
          .includes(person._id.toString());

      if (!currentUser) {
        throw new AuthenticationError("not authenticated");
      }

      const person = await Person.findOne({ name: args.name });
      if (nonFriendAlready(person)) {
        currentUser.friends = currentUser.friends.concat(Person);
      }

      await currentUser.save();

      return currentUser;
    },
    editNumber: async (root, args) => {
      const person = Person.findOne({ name: args.name });
      person.phone = args.phone;
      try {
        await person.save();
      } catch (err) {
        throw new UserInputError(err.message, {
          invalidArgs: args,
        });
      }
      return person;
    },
    createUser: async (root, args) => {
      const user = new User({ username: args.username });
      return user.save().catch((err) => {
        throw new UserInputError(err.message, {
          invalidArgs: args,
        });
      });
    },
    login: async (root, args) => {
      const user = await User.findOne({ username: args.username });
      if (!user || args.password !== "secret") {
        throw new UserInputError("Wrong credentials");
      }
      const userForToken = {
        username: user.username,
        id: user._id,
      };
      return { value: jwt.sign(userForToken, JWT_SECRET) };
    },
  },
};

const server = new ApolloServer({
  typeDefs,
  resolvers,
  context: async ({ req }) => {
    const auth = req ? req.headers.authorization : null;
    if (auth && auth.toLowerCase().startsWith("bearer ")) {
      const decodedToken = jwt.verify(auth.substring(7), JWT_SECRET);
      const currentUser = await User.findById(decodedToken.id).populate(
        "friends"
      );
      return { currentUser };
    }
  },
});

server.listen().then(({ url }) => {
  console.log(`Server ready at ${url}`);
});
