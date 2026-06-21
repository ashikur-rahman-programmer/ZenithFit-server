const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const PORT = process.env.PORT || 5000;
const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");
const app = express();
const { ObjectId } = require("mongodb");

app.use(
  cors({
    credentials: true,
    origin: [process.env.CLIENT_URL],
  }),
);
app.use(express.json());

// verify token
// const JWKS = createRemoteJWKSet(
//   new URL(`${process.env.CLIENT_URL}/api/auth/jwks`),
// );

// const verifyToken = async (req, res, next) => {
//   const authHeader = req?.headers.authorization;
//   // console.log(authHeader);

//   if (!authHeader) {
//     return res.status(401).json({ message: "Unauthorized" });
//   }

//   const token = authHeader.split(" ")[1];

//   // console.log(token);

//   if (!token) {
//     return res.status(401).json({ message: "Unauthorized" });
//   }

//   try {
//     const { payload } = await jwtVerify(token, JWKS);
//     req.user = payload;
//     next();
//   } catch (error) {
//     return res.status(401).json({ message: "Unauthorized" });
//   }
// };

//mongodb connect
const { MongoClient, ServerApiVersion } = require("mongodb");
const uri = process.env.MONGODB_URI;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    //database and collection
    const db = client.db("zenithFit");
    const userCollection = db.collection("user");
    const classesCollection = db.collection("classes");
    const bookingCollection = db.collection("booking");
    const favoritesCollection = db.collection("favorites");
    const trainerCollection = db.collection("trainerApplication");
    const forumCollection = db.collection("forum");

    // --- মিডলওয়্যার: ব্লক চেক ---
    const checkBlocked = async (req, res, next) => {
      const email = req.body.email || req.query.email || req.params.email;
      if (!email) return next();

      const user = await userCollection.findOne({ email });
      const isStatusUpdate =
        req.method === "PATCH" && req.body.status !== undefined;

      if (user?.status === "Blocked" && !isStatusUpdate) {
        return res.status(403).json({ message: "Action restricted by Admin" });
      }
      next();
    };

    // --- USER API ---
    app.get("/api/users", async (req, res) => {
      const users = await userCollection.find().toArray();
      res.send(users);
    });

    app.patch("/api/users/:email", checkBlocked, async (req, res) => {
      try {
        const email = req.params.email;
        const { role, status } = req.body;

        const userToUpdate = await userCollection.findOne({ email });
        if (!userToUpdate) {
          return res.status(404).json({ message: "User not found" });
        }

        if (status === "Blocked" && userToUpdate.role === "Admin") {
          return res
            .status(403)
            .json({ message: "Action restricted: Admins cannot be blocked." });
        }

        const updateDoc = {
          $set: {
            ...(role && { role }),
            ...(status && { status }),
          },
        };

        const result = await userCollection.updateOne({ email }, updateDoc);

        if (result.modifiedCount > 0) {
          res.send({ success: true, message: "User updated successfully" });
        } else {
          res
            .status(400)
            .send({ message: "No changes made or user not found" });
        }
      } catch (error) {
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // --- FORUM API ---
    app.get("/api/forum", async (req, res) => {
      const result = await forumCollection.find().toArray();
      res.send(result);
    });

    app.post("/api/forum", checkBlocked, async (req, res) => {
      try {
        const postData = req.body;
        const result = await forumCollection.insertOne({
          ...postData,
          createdAt: new Date(),
        });
        res.status(201).send(result);
      } catch (error) {
        res.status(500).send({ error: "Failed to publish post" });
      }
    });

    app.delete("/api/forum/:id", checkBlocked, async (req, res) => {
      const id = req.params.id;
      const result = await forumCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // --- TRAINER & STATS API ---
    app.get("/api/user-stats/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const booked = await bookingCollection.countDocuments({ email });
        const favorites = await favoritesCollection.countDocuments({ email });
        const trainerApp = await trainerCollection.findOne({ email });
        res.json({ booked, favorites, trainerApp });
      } catch (error) {
        res.status(500).json({ error: "Failed to fetch stats" });
      }
    });

    app.post("/api/trainer-application", checkBlocked, async (req, res) => {
      try {
        const { email } = req.body;
        const existing = await trainerCollection.findOne({ email });
        if (existing && existing.status === "Pending") {
          return res
            .status(400)
            .json({ error: "Already applied. Please wait." });
        }
        if (existing && existing.status === "Rejected") {
          await trainerCollection.deleteOne({ email });
        }
        const application = {
          ...req.body,
          status: "Pending",
          appliedAt: new Date(),
        };
        const result = await trainerCollection.insertOne(application);
        res.status(201).send(result);
      } catch (error) {
        res.status(500).send({ error: "Server error" });
      }
    });

    app.get("/trainer-application", async (req, res) => {
      try {
        const applications = await trainerCollection
          .find({ status: "Pending" })
          .toArray();
        res.send(applications);
      } catch (error) {
        res.status(500).send({ message: "Error fetching data" });
      }
    });

    app.patch("/trainer-application/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const { status, feedback, email } = req.body;

        const result = await trainerCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status, feedback } },
        );

        if (status === "Approved") {
          await userCollection.updateOne(
            { email: email },
            { $set: { role: "Trainer" } },
          );
        }

        res.send({ success: true });
      } catch (error) {
        res.status(500).send({ success: false, message: "Update Failed" });
      }
    });

    // --- FAVORITES & BOOKING ---
    app.post("/api/favorites/toggle", checkBlocked, async (req, res) => {
      try {
        const { email, classId, classData } = req.body;
        const query = { email, classId };
        const existing = await favoritesCollection.findOne(query);
        if (existing) {
          await favoritesCollection.deleteOne(query);
          return res.send({ status: "removed" });
        } else {
          await favoritesCollection.insertOne({
            email,
            classId,
            classData,
            addedAt: new Date(),
          });
          return res.send({ status: "added" });
        }
      } catch (error) {
        res.status(500).send({ error: "Failed to toggle" });
      }
    });

    // --- CLASSES API ---
    app.get("/api/classes", async (req, res) => {
      /* ...existing logic... */
    });

    app.post("/api/classes", checkBlocked, async (req, res) => {
      const result = await classesCollection.insertOne(req.body);
      res.send(result);
    });

    app.patch("/api/classes/status/:id", checkBlocked, async (req, res) => {
      const result = await classesCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { status: req.body.status } },
      );
      res.send(result);
    });

    app.delete("/api/classes/:id", checkBlocked, async (req, res) => {
      const result = await classesCollection.deleteOne({
        _id: new ObjectId(req.params.id),
      });
      res.send(result);
    });

    // --- TRAINER MY CLASSES ---
    app.get("/api/trainer/my-classes/:email", async (req, res) => {
      const myClasses = await classesCollection
        .find({ trainerEmail: req.params.email })
        .toArray();
      res.json({ classes: myClasses });
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } catch (err) {
    console.error(err);
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Server is running fine!");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
