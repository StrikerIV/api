from nudenet import NudeClassifier
import sys

classifier = NudeClassifier()
print(classifier.classify("images/%s" % sys.argv[1]))
