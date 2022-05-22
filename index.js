const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion } = require('mongodb');
require('dotenv').config();
const app = express();
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.lomnt.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });



// Middleware function
function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send({ message: 'UnAuthorized access' });
    }
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'Forbidden access' })
        }
        req.decoded = decoded;
        next();
    });
}



async function run() {
    try {
        await client.connect();
        const serviceCollection = client.db("doctors_portal").collection("services");
        const bookingCollection = client.db("doctors_portal").collection("bookings");
        const userCollection = client.db("doctors_portal").collection("users");

        // multiple data get api
        app.get('/service', async (req, res) => {
            const query = {};
            const cursor = serviceCollection.find(query);
            const services = await cursor.toArray();
            res.send(services);
        });


        // get all user for admin
        app.get('/user', verifyJWT, async (req, res) => {
            const users = await userCollection.find().toArray();
            res.send(users);
        });


        // Video 8 for use Admin (যদি ইউজার এর রোল এ্যাডমিন হয় অথবা না হয় তাহলে তাকে দিয়া কিছু একটা কাজ করাবো )
        app.get('/admin/:email', async (req, res) => {
            const email = req.params.email;
            const user = await userCollection.findOne({ email: email });
            const isAdmin = user.role === 'admin';
            // রেসপন্স হিসেবে true অথবা false সেন্ড করবে।
            res.send({ admin: isAdmin })
        })


        // update user data for make a admin
        app.put('/user/admin/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            const requester = req.decoded.email;
            const requesterAccount = await userCollection.findOne({ email: requester });
            if (requesterAccount.role === 'admin') {
                const filter = { email: email };
                const updateDoc = {
                    $set: { role: 'admin' },
                };
                const result = await userCollection.updateOne(filter, updateDoc);
                res.send(result);
            }
            else {
                res.status(403).send({ message: 'forbidden' });
            }

        })





        // save user information data in database
        app.put('/user/:email', async (req, res) => {
            const email = req.params.email;
            const user = req.body;
            const filter = { email: email };
            const options = { upsert: true };
            const updateDoc = {
                $set: user,
            };
            const result = await userCollection.updateOne(filter, updateDoc, options);
            const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' })
            res.send({ result, token });
        })



        // Warning: This is not the proper way to query multiple collection. 
        // After learning more about mongodb. use aggregate, lookup, pipeline, match, group
        app.get('/available', async (req, res) => {
            const date = req.query.date;

            // step 1:  get all services
            // (সব সার্ভিসকে গেট করবে)
            const services = await serviceCollection.find().toArray();

            // step 2: get the booking of that day. output: [{}, {}, {}, {}, {}, {}]
            // একদিনে যতগুলা বুকিং হয়েছে তার সবগুলাকে গেট করবে।
            const query = { date: date };
            const bookings = await bookingCollection.find(query).toArray();

            // step 3: for each service
            // সার্ভিসের উপর for each চালাবো ফলে একটা একটা সার্ভিস পাবো।
            services.forEach(service => {
                // step 4: find bookings for that service. output: [{}, {}, {}, {}]
                // এরপর আমরা বুকিং এর সাহায্যে ফিল্টার করে ঐসব সার্ভিসগুলোকে আলাদা করে রাখবো যে সার্ভিসটা ইতমধ্যে বুকিং হয়ে গেছে।
                const serviceBookings = bookings.filter(book => book.treatment === service.name);
                // step 5: select slots for the service Bookings: ['', '', '', '']
                // এবার যে সার্ভিসগুলো ইতমধ্যে বুকিং হয়ে গেছে সেই সার্ভিসের উপর ম্যাপ চালিয়ে একটা একটা booking কৃত সার্ভিস পাবো এবং সেই বুকিং হওয়া সার্ভিসের সব slot গুলো আমরা  => book.slot দিয়ে বের করে নিবো।
                const bookedSlots = serviceBookings.map(book => book.slot);
                // step 6: select those slots that are not in bookedSlots
                // এবার আমাদের সব সার্ভিসের slot গুলো থেকে বুকিং হওয়া service এর slot গুলো বাদ দিবো। 
                const available = service.slots.filter(slot => !bookedSlots.includes(slot));
                //step 7: set available to slots to make it easier 
                // আমাদের সব সার্ভিস এর slotগুলো থেকে বুকিং হওয়া সার্ভিসের slot গুলো বাদ দিলে যে slot গুলো থাকছে তাই-ই আমাদের বর্তমান slot. সেই বর্তমান slot গুলোকে আমরা সার্ভিসের মধ্যে সেট করে দিচ্ছি।  
                service.slots = available;
            });


            res.send(services);
        })



        /**
     * API Naming Convention
     * app.get('/booking') // get all bookings in this collection. or get more than one or by filter
     * app.get('/booking/:id') // get a specific booking 
     * app.post('/booking') // add a new booking
     * app.patch('/booking/:id) //
     * app.delete('/booking/:id) //
    */

        // load booking for particular user
        app.get('/booking', verifyJWT, async (req, res) => {
            const patient = req.query.patient;
            const decodedEmail = req.decoded.email;
            if (patient === decodedEmail) {
                const query = { patient: patient };
                const bookings = await bookingCollection.find(query).toArray();
                return res.send(bookings);
            }
            else {
                return res.status(403).send({ message: 'forbidden access' });
            }
        })



        // insert booking data and check have already user booked or not
        app.post('/booking', async (req, res) => {
            const booking = req.body;

            // check user request already exist or not
            const query = { treatment: booking.treatment, date: booking.date, patient: booking.patient }
            const exist = await bookingCollection.findOne(query);
            if (exist) {
                return res.send({ success: false, booking: exist })
            }

            const result = await bookingCollection.insertOne(booking);
            return res.send({ success: true, result });
        });
    }

    finally {

    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('Hello World!')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})