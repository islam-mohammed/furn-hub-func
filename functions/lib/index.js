"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const functions = require("firebase-functions");
const admin = require('firebase-admin');
const gcs = require('@google-cloud/storage')();
const spawn = require('child-process-promise').spawn;
const path = require('path');
const os = require('os');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
admin.initializeApp(functions.config().firebase);
const app = express();
app.use(cors({ origin: true }));
app.get('/product-details/:id', (req, res) => __awaiter(this, void 0, void 0, function* () {
    const product = yield admin.firestore().collection('products').doc(req.params.id).get();
    if (product.exists) {
        const userAgent = req.get('user-agent');
        if (userAgent.indexOf("facebookexternalhit") === 0) {
            const template = buildHeaderTemplate(product);
            res.status(200).send(template);
        }
        else {
            res.redirect(`https://furniturehubapp.com/#/product-details/${product.id}`);
        }
    }
    else {
        res.redirect('https://furniturehubapp.com/#');
    }
}));
exports.eventsReqHandler = functions.https.onRequest(app);
exports.fixPromo = functions.https.onRequest(app);
exports.generateThumbnail = functions.storage.object().onFinalize((object) => {
    const fileBucket = object.bucket;
    const filePath = object.name;
    const contentType = object.contentType;
    if (!contentType.startsWith('image/')) {
        console.log('This is not an image.');
        return null;
    }
    const fileName = path.basename(filePath);
    if (fileName.startsWith('thumb_')) {
        console.log('Already a Thumbnail.');
        return null;
    }
    const bucket = gcs.bucket(fileBucket);
    const tempFilePath = path.join(os.tmpdir(), fileName);
    const metadata = {
        contentType: contentType,
    };
    return bucket.file(filePath).download({
        destination: tempFilePath,
    }).then(() => {
        console.log('Image downloaded locally to', tempFilePath);
        return spawn('convert', [tempFilePath, '-thumbnail', '200x200>', tempFilePath]);
    }).then(() => {
        console.log('Thumbnail created at', tempFilePath);
        const thumbFileName = `thumb_${fileName}`;
        const thumbFilePath = path.join(path.dirname(filePath), thumbFileName);
        return bucket.upload(tempFilePath, {
            destination: thumbFilePath,
            metadata: metadata,
        });
    }).then(() => fs.unlinkSync(tempFilePath));
});
exports.supplierRequest = functions.firestore
    .document('users/{userId}')
    .onUpdate((change) => __awaiter(this, void 0, void 0, function* () {
    const user = change.before.data();
    const new_user = change.after.data();
    if (new_user.isRequest !== user.isRequest && new_user.isRequest) {
        const adminSnapshot = yield admin.firestore().collection('users').where('type', '==', 'admin').get();
        return adminSnapshot.forEach((adminUser) => __awaiter(this, void 0, void 0, function* () {
            const token = adminUser.data().token;
            const payload = {
                notification: {
                    body: `المستخدم ${new_user.displayName} قام بإرسال طلب إضافة المعرض ${new_user.companyName} إلى قائمة معارض التطبيق`,
                    title: 'طلب إضافة معرض',
                    icon: 'fcm_push_icon',
                    sound: 'default',
                    color: '#ff9800'
                },
                data: {
                    type: 'supplier_request'
                }
            };
            const response = yield admin.messaging().sendToDevice(token, payload);
            console.log(response, token);
            yield admin.firestore().collection('notifications').add({
                uid: adminUser.id,
                title: payload.notification.title,
                body: payload.notification.body,
                status: 'new',
                createdAt: Date.now()
            });
        }));
    }
}));
exports.newProduct = functions.firestore
    .document('products/{productId}')
    .onCreate((snap) => __awaiter(this, void 0, void 0, function* () {
    const prodRef = admin.firestore().collection('products').doc(snap.id);
    const doc = yield prodRef.get();
    const title = doc.data().title;
    const supplierDoc = yield admin.firestore().collection('users').doc(snap.data().uid).get();
    const companyName = supplierDoc.data().companyName;
    const adminSnapshot = yield admin.firestore().collection('users').where('type', '==', 'admin').get();
    if (adminSnapshot.size > 0) {
        return adminSnapshot.forEach((adminUser) => __awaiter(this, void 0, void 0, function* () {
            const token = adminUser.data().token;
            const payload = {
                notification: {
                    body: `تم إضافة المنتج ${title} بواسطة المعرض ${companyName}، المنتج بإنتظار الموافقه للنشر`,
                    title: 'منتج جديد بإنتظار الموافقه',
                    icon: 'fcm_push_icon',
                    sound: 'default',
                    color: '#ff9800'
                },
                data: {
                    type: 'product_request',
                    product_id: doc.id
                }
            };
            yield admin.messaging().sendToDevice(token, payload);
            yield admin.firestore().collection('notifications').add({
                uid: adminUser.id,
                title: payload.notification.title,
                body: payload.notification.body,
                status: 'new',
                createdAt: Date.now()
            });
        }));
    }
}));
exports.updateProduct = functions.firestore
    .document('products/{productId}')
    .onUpdate((change) => __awaiter(this, void 0, void 0, function* () {
    const newProduct = change.after.data();
    const oldProduct = change.before.data();
    if (newProduct.rating !== oldProduct.rating ||
        newProduct.approved !== oldProduct.approved ||
        newProduct.numberOfRatings !== oldProduct.numberOfRatings ||
        newProduct.favorites !== oldProduct.favorites ||
        newProduct.ratings !== oldProduct.ratings ||
        newProduct.reviews !== oldProduct.reviews ||
        newProduct.show !== oldProduct.show ||
        newProduct.visits !== oldProduct.visits) {
        return null;
    }
    if (!oldProduct.mediaURLs) {
        return null;
    }
    const productId = change.after.id;
    const supplierId = newProduct.uid;
    const supplierDoc = yield admin.firestore().collection('users').doc(supplierId).get();
    const companyName = supplierDoc.data().companyName;
    const adminSnapshot = yield admin.firestore().collection('users').where('type', '==', 'admin').get();
    if (adminSnapshot.size > 0) {
        return adminSnapshot.forEach((adminUser) => __awaiter(this, void 0, void 0, function* () {
            const token = adminUser.data().token;
            const payload = {
                notification: {
                    body: `${companyName} قام بتحديث بيانات المنتج ${newProduct.title}`,
                    title: 'تحديث بيانات منتج ',
                    sound: 'default',
                    icon: 'fcm_push_icon',
                    color: '#ff9800'
                },
                data: {
                    type: 'product_update',
                    product_id: productId
                }
            };
            yield admin.messaging().sendToDevice(token, payload);
            yield admin.firestore().collection('notifications').add({
                uid: adminUser.id,
                title: payload.notification.title,
                body: payload.notification.body,
                status: 'new',
                createdAt: Date.now()
            });
        }));
    }
}));
exports.deleteProduct = functions.firestore
    .document('products/{productId}')
    .onDelete((snap) => __awaiter(this, void 0, void 0, function* () {
    console.log(admin.auth());
    const triggeredById = admin.auth().currentUser.uid.uid;
    const deletedProduct = snap.data();
    const supplierId = deletedProduct.uid;
    const supplierDoc = yield admin.firestore().collection('users').doc(supplierId).get();
    const companyName = supplierDoc.data().companyName;
    const adminSnapshot = yield admin.firestore().collection('users').where('type', '==', 'admin').get();
    const userSnapshot = yield admin.firestore().collection('users').doc(supplierId).get();
    let token = '';
    let payload = null;
    if (triggeredById === supplierId) {
        if (adminSnapshot.size > 0) {
            return adminSnapshot.forEach((adminUser) => __awaiter(this, void 0, void 0, function* () {
                token = adminUser.data().token;
                payload = {
                    notification: {
                        body: `${companyName} قام بحذف المنتج ${deletedProduct.title}`,
                        title: 'حذف منتج',
                        icon: 'fcm_push_icon',
                        sound: 'default',
                        color: '#ff9800'
                    }
                };
                yield admin.messaging().sendToDevice(token, payload);
                yield admin.firestore().collection('notifications').add({
                    uid: adminUser.id,
                    title: payload.notification.title,
                    body: payload.notification.body,
                    url: '',
                    status: 'new',
                    createdAt: Date.now()
                });
            }));
        }
    }
    token = userSnapshot.data().token;
    payload = {
        notification: {
            body: `تم حذف المنتج الخاص بك، الرجاء مراجعة إدارة الموقع`,
            title: 'حذف منتج',
            icon: 'fcm_push_icon',
            sound: 'default',
            color: '#ff9800'
        }
    };
    yield admin.messaging().sendToDevice(token, payload);
    yield admin.firestore().collection('notifications').add({
        uid: supplierId,
        title: payload.notification.title,
        body: payload.notification.body,
        url: '',
        status: 'new',
        createdAt: Date.now()
    });
}));
exports.approveProductChanged = functions.firestore
    .document('products/{productId}')
    .onUpdate((change) => __awaiter(this, void 0, void 0, function* () {
    const newProduct = change.after.data();
    const oldProduct = change.before.data();
    if (newProduct.approved === oldProduct.approved) {
        return null;
    }
    const supplierId = newProduct.uid;
    const supplierDoc = yield admin.firestore().collection('users').doc(supplierId).get();
    const token = supplierDoc.data().token;
    let body = '';
    if (newProduct.approved) {
        body = ` تم الموافقة على طلبك وإضافة المنتج ${newProduct.title}، إلى قائمة منتجات التطبيق`;
    }
    else {
        body = ` لم تتم الموافقه على إضافةالمنتج  ${newProduct.title}، إلى قائمة منتجات التطبيق`;
    }
    const payload = {
        notification: {
            body: body,
            title: 'تحديث حالة منتج',
            icon: 'fcm_push_icon',
            sound: 'default',
            color: '#ff9800'
        }
    };
    yield admin.firestore().collection('notifications').add({
        uid: supplierId,
        title: payload.notification.title,
        body: payload.notification.body,
        status: 'new',
        createdAt: Date.now()
    });
    return yield admin.messaging().sendToDevice(token, payload);
}));
exports.approveSupplierChanged = functions.firestore
    .document('users/{userId}')
    .onUpdate((change) => __awaiter(this, void 0, void 0, function* () {
    const newSupplier = change.after.data();
    const oldSupplier = change.before.data();
    if (newSupplier.approved === oldSupplier.approved) {
        return null;
    }
    const token = newSupplier.token;
    let body = '';
    if (newSupplier.approved) {
        body = `تمت الموافقه على إضافة معرضك إلى قائمة معارض النطبيق`;
    }
    else {
        body = `تم إلغاء الموافقة على إضافة معرضك إلى قائمة معارض التطبيق`;
    }
    const payload = {
        notification: {
            body: body,
            title: 'تحديث حالة معرض بإنتظار الموافقه',
            icon: 'fcm_push_icon',
            sound: 'default',
            color: '#ff9800'
        }
    };
    yield admin.firestore().collection('notifications').add({
        uid: change.after.id,
        title: payload.notification.title,
        body: payload.notification.body,
        status: 'new',
        createdAt: Date.now()
    });
    return yield admin.messaging().sendToDevice(token, payload);
}));
exports.enquiryMessage = functions.firestore
    .document('enquiries/{enquiryId}')
    .onCreate((snap) => __awaiter(this, void 0, void 0, function* () {
    const enquiry = snap.data();
    console.log(enquiry.productId);
    const product = yield admin.firestore().collection('products').doc(enquiry.productId).get();
    const payload = {
        notification: {
            body: `${enquiry.supplier.name} أرسل لك إستعلام بخصوص المنتج ${product.data().title}`,
            title: 'إستعلام',
            icon: 'fcm_push_icon',
            sound: 'default',
            color: '#ff9800'
        },
        data: {
            type: 'enquiry_request'
        }
    };
    const recUser = yield admin.firestore().collection('users').doc(enquiry.supplier.id).get();
    yield admin.firestore().collection('notifications').add({
        uid: recUser.id,
        title: payload.notification.title,
        body: payload.notification.body,
        status: 'new',
        createdAt: Date.now()
    });
    return yield admin.messaging().sendToDevice(recUser.data().token, payload);
}));
exports.message = functions.firestore
    .document('enquiries/{enquiryId}/messages/{messageId}')
    .onCreate((snap) => __awaiter(this, void 0, void 0, function* () {
    const message = snap.data();
    const userDoc = yield admin.firestore().collection('users').doc(message.to.id).get();
    const token = userDoc.data().token;
    const payload = {
        notification: {
            body: `${message.from.name} أرسل لك رسالة`,
            title: 'رسالة جديده',
            icon: 'fcm_push_icon',
            sound: 'default',
            color: '#ff9800'
        },
        data: {
            type: 'new_message'
        }
    };
    yield admin.firestore().collection('notifications').add({
        uid: userDoc.id,
        title: payload.notification.title,
        body: payload.notification.body,
        status: 'new',
        createdAt: Date.now()
    });
    return yield admin.messaging().sendToDevice(token, payload);
}));
exports.notification = functions.firestore
    .document('notifications/{notificationId}')
    .onCreate((snap) => __awaiter(this, void 0, void 0, function* () {
    const message = snap.data();
    if (message.senderid) {
        const userDoc = yield admin.firestore().collection('users').doc(message.uid).get();
        const token = userDoc.data().token;
        const payload = {
            notification: {
                body: message.body,
                title: message.title,
                icon: 'fcm_push_icon',
                sound: 'default',
                color: '#ff9800'
            }
        };
        return yield admin.messaging().sendToDevice(token, payload);
    }
}));
// exports.newRating = functions.firestore
// .document('ratings/{ratingId}')
// .onCreate(async snap => {
// 	const newRating = snap.data();
// 	console.log(newRating.productId)
// 	const productRef = admin.firestore().collection('products').doc(newRating.productId);
// 	const productDoc = await productRef.get();
// 	const numberOfRatings = productDoc.size;
// 	console.log(numberOfRatings)
// 	const ratings = newRating.rating + productDoc.data().ratings;
// 	const rating = ratings / numberOfRatings;
// 	return await admin.firestore().collection('products').doc(newRating.productId).update({
// 		rating: rating,
// 		ratings: ratings,
// 		numberOfRatings: numberOfRatings
// 	}, { merge: true })
// })
function buildHeaderTemplate(product) {
    return `
    <!DOCTYPE html>
    <html>
      <head>
        <title>${product.data().title}</title>
        <meta name="description" content="${product.data().description}"/>
        <meta http-equiv="Content-type" content="text/html; charset=utf-8"/>
        <meta property="og:title"        content="${product.data().title}" />
        <meta property="og:description"  content="${product.data().description}" />
        <meta property="og:url"          content="https://furnitruehubapp.com/#/product-details/${product.id}" />
        <meta property="og:image"        content="${product.data().mediaURLs[0].url}" />
        <meta property="og:type"         content="product" />
      </head>
    </html>
  `;
}
//# sourceMappingURL=index.js.map